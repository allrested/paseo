import { describe, expect, it } from "vitest";
import {
  createThrottle,
  fitFrame,
  keyText,
  modifierMask,
  mouseButton,
  toPagePoint,
  viewportForPane,
  viewStatusForError,
} from "./view-model";

describe("fitFrame", () => {
  it("fills the pane when the aspect ratios match", () => {
    expect(fitFrame({ width: 800, height: 600 }, { width: 400, height: 300 })).toEqual({
      left: 0,
      top: 0,
      width: 800,
      height: 600,
    });
  });
  it("letterboxes a wider frame and centres it", () => {
    expect(fitFrame({ width: 800, height: 800 }, { width: 400, height: 200 })).toEqual({
      left: 0,
      top: 200,
      width: 800,
      height: 400,
    });
  });
  it("pillarboxes a taller frame", () => {
    expect(fitFrame({ width: 800, height: 400 }, { width: 200, height: 400 })).toEqual({
      left: 300,
      top: 0,
      width: 200,
      height: 400,
    });
  });
  it("is empty for an unmeasured pane or frame", () => {
    expect(fitFrame({ width: 0, height: 0 }, { width: 400, height: 300 })).toEqual({
      left: 0,
      top: 0,
      width: 0,
      height: 0,
    });
    expect(fitFrame({ width: 800, height: 600 }, { width: 0, height: 0 })).toEqual({
      left: 0,
      top: 0,
      width: 0,
      height: 0,
    });
  });
});

describe("toPagePoint", () => {
  it("scales a point on the displayed frame to page CSS pixels", () => {
    expect(
      toPagePoint({ x: 400, y: 100 }, { width: 800, height: 400 }, { width: 400, height: 200 }),
    ).toEqual({ x: 200, y: 50 });
  });
  it("clamps a point dragged outside the frame", () => {
    expect(
      toPagePoint({ x: -5, y: 900 }, { width: 800, height: 400 }, { width: 400, height: 200 }),
    ).toEqual({ x: 0, y: 200 });
  });
});

describe("viewportForPane", () => {
  it("rounds the size and caps the pixel ratio at 2", () => {
    expect(viewportForPane({ width: 390.4, height: 700.6 }, 3)).toEqual({
      width: 390,
      height: 701,
      deviceScaleFactor: 2,
    });
  });
  it("has no viewport until the pane is measured", () => {
    expect(viewportForPane({ width: 0, height: 0 }, 2)).toBeNull();
  });
});

describe("input helpers", () => {
  it("builds the CDP modifier mask", () => {
    expect(modifierMask({ altKey: true, ctrlKey: false, metaKey: true, shiftKey: true })).toBe(
      1 + 4 + 8,
    );
    expect(modifierMask({ altKey: false, ctrlKey: true, metaKey: false, shiftKey: false })).toBe(2);
  });
  it("names mouse buttons", () => {
    expect([mouseButton(0), mouseButton(1), mouseButton(2)]).toEqual(["left", "middle", "right"]);
  });
  it("gives text only for a printable key without a command modifier", () => {
    expect(keyText({ key: "a", ctrlKey: false, metaKey: false })).toBe("a");
    expect(keyText({ key: "a", ctrlKey: true, metaKey: false })).toBeUndefined();
    expect(keyText({ key: "Enter", ctrlKey: false, metaKey: false })).toBeUndefined();
  });
  it("throttles to one call per interval", () => {
    let now = 0;
    const allow = createThrottle(33, () => now);
    expect(allow()).toBe(true);
    now = 20;
    expect(allow()).toBe(false);
    now = 33;
    expect(allow()).toBe(true);
  });
  it("maps daemon error codes to a pane status", () => {
    expect(viewStatusForError("browser_tab_not_found")).toBe("closed");
    expect(viewStatusForError("browser_no_host")).toBe("unreachable");
    expect(viewStatusForError("browser_timeout")).toBe("unresponsive");
    expect(viewStatusForError("DaemonRpcError: browser_tab_not_found")).toBe("closed");
    expect(viewStatusForError("anything else")).toBe("unresponsive");
  });
});
