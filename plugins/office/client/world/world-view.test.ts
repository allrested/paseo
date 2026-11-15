import { expect, test } from "vitest";
import { floorNote } from "./world-view.js";

test("an empty office says so, and a full one says who has no desk", () => {
  expect(floorNote(0, 0)).toBe("No agents on this host yet. One that starts takes a desk here.");
  expect(floorNote(5, 0)).toBe(null);
  expect(floorNote(13, 1)).toBe(
    "1 agent has no desk on this floor. Turn 3D view off to see everyone.",
  );
  expect(floorNote(15, 3)).toBe(
    "3 agents have no desk on this floor. Turn 3D view off to see everyone.",
  );
});
