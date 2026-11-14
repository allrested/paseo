import { describe, expect, test, vi } from "vitest";
import { insertSavedPrompt } from "./slash.js";

const PROMPTS = [
  { name: "review", text: "Review the diff and list the risks first." },
  { name: "release notes", text: "Write release notes." },
];

function ready(prompts: unknown = PROMPTS) {
  return async () => ({ status: "ready" as const, revision: "r1", values: { prompts } });
}

function composer() {
  return { setPrompt: vi.fn(), focus: vi.fn(async () => {}) };
}

describe("/prompt", () => {
  test("puts the named prompt in the composer and the cursor after it", async () => {
    const target = composer();
    await insertSavedPrompt({ args: "review", read: ready(), composer: target });
    expect(target.setPrompt).toHaveBeenCalledExactlyOnceWith(PROMPTS[0]?.text);
    expect(target.focus).toHaveBeenCalledExactlyOnceWith();
  });

  test("the start of one name is enough", async () => {
    const target = composer();
    await insertSavedPrompt({ args: "rel", read: ready(), composer: target });
    expect(target.setPrompt).toHaveBeenCalledExactlyOnceWith("Write release notes.");
  });

  test("a start that fits several names lists them and changes nothing", async () => {
    const target = composer();
    await expect(
      insertSavedPrompt({ args: "re", read: ready(), composer: target }),
    ).rejects.toThrow('"re" starts several saved prompts: review, release notes');
    expect(target.setPrompt).not.toHaveBeenCalled();
    expect(target.focus).not.toHaveBeenCalled();
  });

  test("an unknown name, or none, lists what is saved", async () => {
    await expect(
      insertSavedPrompt({ args: "deploy", read: ready(), composer: composer() }),
    ).rejects.toThrow('No saved prompt starts with "deploy". Saved: review, release notes');
    await expect(
      insertSavedPrompt({ args: "", read: ready(), composer: composer() }),
    ).rejects.toThrow("Type a name after /prompt. Saved: review, release notes");
  });

  test("a long list is cut short", async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ name: `p${i}`, text: "x" }));
    await expect(
      insertSavedPrompt({ args: "", read: ready(many), composer: composer() }),
    ).rejects.toThrow("Saved: p0, p1, p2, p3, p4, p5, p6, p7 and 4 more");
  });

  test("with nothing saved it says where prompts are made", async () => {
    await expect(
      insertSavedPrompt({ args: "review", read: ready([]), composer: composer() }),
    ).rejects.toThrow("No saved prompts yet. Add one in Settings, under Saved prompts");
  });

  test("a list that cannot be read says why", async () => {
    const read = async () => ({ status: "invalid" as const, revision: "r1", error: "bad file" });
    await expect(insertSavedPrompt({ args: "review", read, composer: composer() })).rejects.toThrow(
      "The saved prompts cannot be read: bad file",
    );
  });

  test("an agent with no composer is said, not ignored", async () => {
    await expect(
      insertSavedPrompt({ args: "review", read: ready(), composer: undefined }),
    ).rejects.toThrow("This agent has no composer to put the prompt in");
  });
});
