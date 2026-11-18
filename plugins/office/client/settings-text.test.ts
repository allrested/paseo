import { expect, test } from "vitest";
import { settingsEntry, settingsProblems } from "./settings-text.js";

test("no schedule failure is no problem and no card", () => {
  expect(settingsProblems(null, null)).toEqual([]);
  expect(settingsEntry([], () => undefined)).toBeNull();
});

test("each schedule that could not follow the settings is a sentence", () => {
  expect(settingsProblems("unknown zone Mars/Olympus", "no such folder")).toEqual([
    "Unable to schedule the stand-up notes: unknown zone Mars/Olympus",
    "Unable to schedule the incidents check: no such folder",
  ]);
});

test("the card counts the problems, in the danger tone, and opens what it is given", () => {
  let opened = 0;
  const one = settingsEntry(["a"], () => {
    opened += 1;
  });
  expect(one?.title).toBe("Settings");
  expect(one?.note).toEqual({ text: "1 problem", tone: "danger" });
  one?.onOpen();
  expect(opened).toBe(1);
  expect(settingsEntry(["a", "b"], () => undefined)?.note.text).toBe("2 problems");
});
