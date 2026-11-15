import { expect, test } from "vitest";
import { ago, countLabel, entryLabel, entryMeta, entryTitle, folderName } from "./format.js";

const NOW = Date.parse("2026-11-15T12:00:00.000Z");

test("a time reads as how long ago, and as a date once it is over a month", () => {
  expect(ago("2026-11-15T11:59:30.000Z", NOW)).toBe("just now");
  expect(ago("2026-11-15T11:18:00.000Z", NOW)).toBe("42 min ago");
  expect(ago("2026-11-15T07:00:00.000Z", NOW)).toBe("5 h ago");
  expect(ago("2026-11-12T12:00:00.000Z", NOW)).toBe("3 d ago");
  expect(ago("2026-09-01T12:00:00.000Z", NOW)).toBe("on 2026-09-01");
});

test("a folder is named by its last part, whichever way its slashes lean", () => {
  expect(folderName("/work/shop")).toBe("shop");
  expect(folderName("/work/shop/")).toBe("shop");
  expect(folderName("C:\\work\\shop")).toBe("shop");
  expect(folderName("/")).toBe("/");
});

test("a row names its agent, its folder and its time", () => {
  const entry = {
    kind: "failed" as const,
    title: "Checkout total",
    folder: "/work/shop",
    at: "2026-11-15T11:18:00.000Z",
  };

  expect(entryTitle(entry)).toBe("Checkout total");
  expect(entryMeta(entry, NOW)).toBe("shop · 42 min ago");
  expect(entryLabel(entry)).toBe("Failed: Checkout total. Open the agent");
  expect(entryTitle({ title: null })).toBe("Untitled agent");
});

test("the count is read as entries", () => {
  expect(countLabel(1)).toBe("1 new entry");
  expect(countLabel(12)).toBe("12 new entries");
});
