import { expect, test } from "vitest";
import { moreLabel, otherLabel, runLabel } from "./labels.js";

test("a cell says which run its output is from", () => {
  expect(runLabel(12)).toBe("[12]");
  expect(runLabel(null)).toBe("[ ]");
});

test("a cut output says how much is left in the file", () => {
  expect(moreLabel(1)).toBe("1 more character in the file");
  expect(moreLabel(48_211)).toBe("48,211 more characters in the file");
});

test("an output that is not drawn names its types", () => {
  expect(otherLabel({ kind: "other", types: ["text/html", "image/svg+xml"] })).toBe(
    "An output that is not shown here (text/html, image/svg+xml)",
  );
});
