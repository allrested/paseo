import { describe, expect, test } from "vitest";
import { MAX_NAME, MAX_PROMPTS, MAX_TEXT, savedPromptsSettings } from "./settings.js";

const schema = savedPromptsSettings.schema;

function problem(values: unknown): string {
  const parsed = schema.safeParse(values);
  if (parsed.success) throw new Error("expected a refusal");
  return parsed.error.issues[0]?.message ?? "";
}

describe("saved prompts settings", () => {
  test("starts empty and lives on the host, so every client of it sees one list", () => {
    expect(schema.parse({})).toEqual({ prompts: [] });
    expect(savedPromptsSettings.scope).toBe("host");
  });

  test("keeps a prompt's text as written and trims its name", () => {
    const text = "  Review the diff.\n\nList risks first.\n";
    expect(schema.parse({ prompts: [{ name: " review ", text }] })).toEqual({
      prompts: [{ name: "review", text }],
    });
  });

  test("says what is wrong with a name or a text in plain words", () => {
    expect(problem({ prompts: [{ name: "  ", text: "x" }] })).toBe("Give the prompt a name");
    expect(problem({ prompts: [{ name: "a".repeat(MAX_NAME + 1), text: "x" }] })).toBe(
      `A name has at most ${MAX_NAME} characters`,
    );
    expect(problem({ prompts: [{ name: "two\nlines", text: "x" }] })).toBe("A name is one line");
    expect(problem({ prompts: [{ name: "a", text: " \n " }] })).toBe("A prompt needs some text");
    expect(problem({ prompts: [{ name: "a", text: "x".repeat(MAX_TEXT + 1) }] })).toBe(
      "A prompt has at most 20,000 characters",
    );
  });

  test("refuses a second prompt of the same name, whatever its case", () => {
    expect(
      problem({
        prompts: [
          { name: "Review", text: "a" },
          { name: "review", text: "b" },
        ],
      }),
    ).toBe('A prompt named "Review" exists already');
  });

  test("holds a bounded list", () => {
    const prompts = Array.from({ length: MAX_PROMPTS + 1 }, (_, i) => ({
      name: `p${i}`,
      text: "x",
    }));
    expect(problem({ prompts })).toBe(`The list holds at most ${MAX_PROMPTS} prompts`);
    expect(schema.safeParse({ prompts: prompts.slice(1) }).success).toBe(true);
  });
});
