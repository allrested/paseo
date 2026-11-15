import { expect, test } from "vitest";
import { taskBranch } from "./branch.js";

test("keeps the key and turns the title into dashed lowercase words", () => {
  expect(taskBranch("BWLT-12", "Add the Dozn webhook (v2)!")).toBe(
    "BWLT-12-add-the-dozn-webhook-v2",
  );
});

test("drops accents and anything a branch name cannot hold", () => {
  expect(taskBranch("7", "Café: résumé ~ upload / `fix`")).toBe("7-cafe-resume-upload-fix");
});

test("cuts a long title at a word", () => {
  expect(taskBranch("AB-1", "one two three four five six seven eight nine ten eleven")).toBe(
    "AB-1-one-two-three-four-five-six-seven-eight",
  );
});

test("cuts a single long word at the limit", () => {
  expect(taskBranch("AB-1", "x".repeat(60))).toBe(`AB-1-${"x".repeat(40)}`);
});

test("is the key alone when the title has no letters or digits", () => {
  expect(taskBranch("AB-1", "🚀 !!!")).toBe("AB-1");
});
