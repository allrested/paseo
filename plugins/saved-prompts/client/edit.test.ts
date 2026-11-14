import { describe, expect, test } from "vitest";
import { applyEdit, removePrompt } from "./edit.js";

const PROMPTS = [
  { name: "review", text: "Review the diff." },
  { name: "tests", text: "Write the missing tests." },
];

describe("applyEdit", () => {
  test("a new prompt goes to the end of the list", () => {
    expect(applyEdit(PROMPTS, { original: null, name: " notes ", text: "Write notes." })).toEqual({
      ok: true,
      values: { prompts: [...PROMPTS, { name: "notes", text: "Write notes." }] },
    });
  });

  test("an edited prompt keeps its place, under a new name too", () => {
    expect(
      applyEdit(PROMPTS, { original: "review", name: "Review PR", text: "Review it." }),
    ).toEqual({
      ok: true,
      values: { prompts: [{ name: "Review PR", text: "Review it." }, PROMPTS[1]] },
    });
  });

  test("a prompt may keep its own name, and change only its case", () => {
    const applied = applyEdit(PROMPTS, { original: "tests", name: "Tests", text: "Write tests." });
    expect(applied).toEqual({
      ok: true,
      values: { prompts: [PROMPTS[0], { name: "Tests", text: "Write tests." }] },
    });
  });

  test("what the list refuses comes back as its sentence", () => {
    expect(applyEdit(PROMPTS, { original: null, name: "REVIEW", text: "x" })).toEqual({
      ok: false,
      error: 'A prompt named "review" exists already',
    });
    expect(applyEdit(PROMPTS, { original: "tests", name: "", text: "x" })).toEqual({
      ok: false,
      error: "Give the prompt a name",
    });
    expect(applyEdit(PROMPTS, { original: null, name: "empty", text: "\n" })).toEqual({
      ok: false,
      error: "A prompt needs some text",
    });
  });

  test("a prompt another device renamed or deleted meanwhile is not written over a neighbour", () => {
    expect(applyEdit(PROMPTS, { original: "gone", name: "gone", text: "x" })).toEqual({
      ok: false,
      error: "This prompt was renamed or deleted on another device. Discard, then open it again",
    });
  });
});

test("removePrompt takes out the one of that name", () => {
  expect(removePrompt(PROMPTS, "review")).toEqual({ prompts: [PROMPTS[1]] });
  expect(removePrompt(PROMPTS, "gone")).toEqual({ prompts: PROMPTS });
});
