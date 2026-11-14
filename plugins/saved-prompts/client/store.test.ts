import { describe, expect, test, vi } from "vitest";
import { appendPrompt, stored } from "./store.js";

const PROMPTS = [{ name: "review", text: "Review the diff." }];
const read = async () => ({
  status: "ready" as const,
  revision: "r7",
  values: { prompts: PROMPTS },
});

describe("the saved list outside the settings screen", () => {
  test("a read gives the list and the revision a write must name", () => {
    expect(stored({ status: "ready", revision: "r7", values: {} })).toEqual({
      revision: "r7",
      prompts: [],
    });
    expect(() => stored({ status: "invalid", revision: "r7", error: "bad file" })).toThrow(
      "The saved prompts cannot be read: bad file",
    );
  });

  test("a new prompt is written after the ones already there, at the revision just read", async () => {
    const write = vi.fn(async () => ({ status: "saved" as const }));
    await appendPrompt({ read, write, name: "notes", text: "Write notes.\n" });
    expect(write).toHaveBeenCalledExactlyOnceWith({
      revision: "r7",
      values: { prompts: [...PROMPTS, { name: "notes", text: "Write notes.\n" }] },
    });
  });

  test("a name the list has is refused before anything is written", async () => {
    const write = vi.fn(async () => ({ status: "saved" as const }));
    await expect(appendPrompt({ read, write, name: "Review", text: "x" })).rejects.toThrow(
      'A prompt named "review" exists already',
    );
    expect(write).not.toHaveBeenCalled();
  });

  test("the host's refusal is the error", async () => {
    const write = vi.fn(async () => ({
      status: "conflict" as const,
      error: "Settings changed since they were read",
    }));
    await expect(appendPrompt({ read, write, name: "notes", text: "x" })).rejects.toThrow(
      "Settings changed since they were read",
    );
  });
});
