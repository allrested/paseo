import { describe, expect, it } from "vitest";
import { designPaths } from "./paths.js";

describe("designPaths", () => {
  it("lives under PASEO_HOME, else ~/.paseo", () => {
    expect(designPaths({ PASEO_HOME: "/h" }, "/home/u")).toEqual({
      filesJson: "/h/design/files.json",
      runDir: "/h/design/run",
    });
    expect(designPaths({}, "/home/u").filesJson).toBe("/home/u/.paseo/design/files.json");
  });
});
