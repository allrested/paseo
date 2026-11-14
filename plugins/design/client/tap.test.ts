import { describe, expect, it } from "vitest";
import { pictureToFrame, tapToPicture } from "./tap.js";

describe("tapToPicture", () => {
  it("maps a tap to the picture shown contained in its frame", () => {
    // 400x200 picture in a 200x200 frame: drawn 200x100, 50 px bands above and below.
    expect(
      tapToPicture({ x: 100, y: 100 }, { width: 200, height: 200 }, { width: 400, height: 200 }),
    ).toEqual({ x: 0.5, y: 0.5 });
    expect(
      tapToPicture({ x: 0, y: 50 }, { width: 200, height: 200 }, { width: 400, height: 200 }),
    ).toEqual({ x: 0, y: 0 });
  });
  it("ignores a tap on the empty band", () => {
    expect(
      tapToPicture({ x: 100, y: 10 }, { width: 200, height: 200 }, { width: 400, height: 200 }),
    ).toBeNull();
  });
  it("maps nothing before the frame or the picture has a size", () => {
    expect(
      tapToPicture({ x: 1, y: 1 }, { width: 0, height: 0 }, { width: 400, height: 200 }),
    ).toBeNull();
    expect(
      tapToPicture({ x: 1, y: 1 }, { width: 200, height: 200 }, { width: 0, height: 0 }),
    ).toBeNull();
  });
});

describe("pictureToFrame", () => {
  it("places a box of the picture over the picture as drawn in its frame", () => {
    // The same 400x200 picture in a 200x200 frame: drawn 200x100 from y = 50.
    expect(
      pictureToFrame(
        { x: 0.25, y: 0.5, width: 0.5, height: 0.5 },
        { width: 200, height: 200 },
        { width: 400, height: 200 },
      ),
    ).toEqual({ left: 50, top: 100, width: 100, height: 50 });
    expect(
      pictureToFrame(
        { x: 0, y: 0, width: 1, height: 1 },
        { width: 0, height: 0 },
        { width: 4, height: 2 },
      ),
    ).toBeNull();
  });
});
