import { describe, expect, it } from "vitest";
import { cutSnippet, messageOf } from "./transcript.js";

describe("messageOf", () => {
  it("takes what the user typed", () => {
    expect(
      messageOf({
        type: "user",
        timestamp: "2026-11-14T08:00:00.000Z",
        message: { content: "Fix the login" },
      }),
    ).toEqual({ role: "user", at: "2026-11-14T08:00:00.000Z", text: "Fix the login" });
  });

  it("takes the text an agent wrote, not its thinking or its tool calls", () => {
    expect(
      messageOf({
        type: "assistant",
        timestamp: "2026-11-14T08:00:05.000Z",
        message: {
          content: [
            { type: "thinking", thinking: "secret plan" },
            { type: "text", text: "The login fails on an empty token." },
            { type: "tool_use", name: "Bash", input: { command: "grep token" } },
            { type: "text", text: "I will fix it." },
          ],
        },
      }),
    ).toEqual({
      role: "assistant",
      at: "2026-11-14T08:00:05.000Z",
      text: "The login fails on an empty token.\nI will fix it.",
    });
  });

  it("skips tool output, text Claude Code injected, side chats and other line types", () => {
    const toolResult = {
      type: "user",
      message: { content: [{ type: "tool_result", content: "token found" }] },
    };
    const injected = {
      type: "user",
      isMeta: true,
      message: { content: [{ type: "text", text: "<reminder>" }] },
    };
    const sidechain = {
      type: "assistant",
      isSidechain: true,
      message: { content: [{ type: "text", text: "sub" }] },
    };
    expect(messageOf(toolResult)).toBeNull();
    expect(messageOf(injected)).toBeNull();
    expect(messageOf(sidechain)).toBeNull();
    expect(messageOf({ type: "attachment", message: { content: "x" } })).toBeNull();
    expect(messageOf({ type: "user" })).toBeNull();
    expect(messageOf("not an object")).toBeNull();
  });
});

describe("cutSnippet", () => {
  it("cuts around the first match, whatever its case, and keeps the text's own letters", () => {
    expect(cutSnippet("We saw that the Login Token was empty today.", "login token")).toEqual({
      before: "We saw that the ",
      match: "Login Token",
      after: " was empty today.",
    });
  });

  it("puts every run of white space on one line", () => {
    expect(cutSnippet("first line\n\n  second   line with\ttoken\nthird", "token")).toEqual({
      before: "first line second line with ",
      match: "token",
      after: " third",
    });
  });

  it("keeps 60 characters before and 120 after, and marks what it left out", () => {
    const text = `${"a".repeat(200)} needle ${"b".repeat(300)}`;
    const cut = cutSnippet(text, "needle");
    expect(cut?.before).toBe(`…${"a".repeat(59)} `);
    expect(cut?.match).toBe("needle");
    expect(cut?.after).toBe(` ${"b".repeat(119)}…`);
  });

  it("is null when the text does not hold the words", () => {
    expect(cutSnippet("nothing here", "needle")).toBeNull();
  });
});
