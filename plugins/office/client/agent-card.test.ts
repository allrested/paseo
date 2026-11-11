import { expect, test } from "vitest";
import { textAfterSend } from "./agent-card.js";

test("the sent text is cleared", () => {
  const text: string = textAfterSend("  fix the tests ", "fix the tests");
  expect(text).toEqual("");
});

test("text typed while sending is kept", () => {
  const text: string = textAfterSend("fix the tests and lint", "fix the tests");
  expect(text).toEqual("fix the tests and lint");
});
