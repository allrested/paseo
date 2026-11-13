import { describe, expect, it } from "vitest";
import { designPaths, scratchDir } from "./paths.js";

describe("designPaths", () => {
  it("lives under PASEO_HOME, else ~/.paseo", () => {
    expect(designPaths({ PASEO_HOME: "/h" }, "/home/u")).toEqual({
      filesJson: "/h/design/files.json",
      scratchRoot: "/h/design/scratch",
      runDir: "/h/design/run",
    });
    expect(designPaths({}, "/home/u").filesJson).toBe("/home/u/.paseo/design/files.json");
  });
  it("gives each project its own scratch folder, with a safe name", () => {
    const paths = designPaths({ PASEO_HOME: "/h" }, "/home/u");
    expect(scratchDir(paths, "proj/../x")).toBe("/h/design/scratch/proj_.._x");
  });
});
