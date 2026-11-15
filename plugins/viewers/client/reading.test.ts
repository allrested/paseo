import { PluginFileDeletedError } from "@getpaseo/plugin/client";
import { expect, test } from "vitest";
import { TABLE_MAX_BYTES, counted, readProblem, sizeLabel, tooLarge } from "./reading.js";

test("a size reads in megabytes", () => {
  expect(sizeLabel(TABLE_MAX_BYTES)).toBe("10.0 MB");
  expect(sizeLabel(3_565_158)).toBe("3.4 MB");
});

test("a file over the limit says both sizes and where to go", () => {
  expect(tooLarge("a table", 12 * 1024 * 1024, TABLE_MAX_BYTES)).toBe(
    "This file is 12.0 MB, and a table is shown up to 10.0 MB. Open it with another viewer from the tab's menu.",
  );
});

test("a deleted file is named as such; any other failure gives its reason", () => {
  expect(readProblem(new PluginFileDeletedError())).toBe("This file was deleted.");
  expect(readProblem(new Error("offline"))).toBe("Unable to read the file: offline");
});

test("a count has its thousands apart", () => {
  expect(counted(999)).toBe("999");
  expect(counted(1_204_000)).toBe("1,204,000");
});
