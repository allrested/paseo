import { describe, expect, test } from "vitest";
import {
  BROWSER_VIEW_OPCODE,
  decodeBrowserViewFrame,
  encodeBrowserViewFrame,
} from "./browser-view.js";
import { decodeBinaryFrame } from "./demux.js";

const frame = {
  subscriptionId: "6f1c2f0e-8f3b-4c55-9a43-1f1f6e1d2b77",
  sequence: 4_000_000_001,
  deviceWidth: 390,
  deviceHeight: 700,
  pageScaleFactor: 1.5,
  scrollX: 0,
  scrollY: 1234.5,
  jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]),
};

describe("browser view frame", () => {
  test("round trips", () => {
    const bytes = encodeBrowserViewFrame(frame);
    expect(bytes[0]).toBe(BROWSER_VIEW_OPCODE);
    expect(decodeBrowserViewFrame(bytes)).toEqual(frame);
  });

  test("decodes from a view into a larger buffer", () => {
    const bytes = encodeBrowserViewFrame(frame);
    const padded = new Uint8Array(bytes.length + 8);
    padded.set(bytes, 8);
    expect(decodeBrowserViewFrame(padded.subarray(8))).toEqual(frame);
  });

  test("rejects another opcode, an unknown version and a truncated frame", () => {
    const bytes = encodeBrowserViewFrame(frame);
    expect(decodeBrowserViewFrame(new Uint8Array([0x01, 1, 0]))).toBeNull();
    const wrongVersion = bytes.slice();
    wrongVersion[1] = 9;
    expect(decodeBrowserViewFrame(wrongVersion)).toBeNull();
    expect(decodeBrowserViewFrame(bytes.subarray(0, 10))).toBeNull();
  });

  test("the demux names the frame kind", () => {
    expect(decodeBinaryFrame(encodeBrowserViewFrame(frame))).toEqual({
      kind: "browser_view",
      frame,
    });
  });
});
