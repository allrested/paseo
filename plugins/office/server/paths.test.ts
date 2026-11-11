import { expect, test } from "vitest";
import { boardsFile, officeDir, paseoHome } from "./paths.js";

const HOME = "/home/u";

test("defaults PASEO_HOME to ~/.paseo and expands a leading ~/", () => {
  expect(paseoHome({}, HOME)).toBe("/home/u/.paseo");
  expect(paseoHome({ PASEO_HOME: "~/dev-home" }, HOME)).toBe("/home/u/dev-home");
  expect(paseoHome({ PASEO_HOME: "/srv/paseo" }, HOME)).toBe("/srv/paseo");
});

test("keeps the office's files under PASEO_HOME/office", () => {
  const env = { PASEO_HOME: "/srv/paseo" };
  expect(officeDir(env, HOME)).toBe("/srv/paseo/office");
  expect(boardsFile(env, HOME)).toBe("/srv/paseo/office/boards.json");
});
