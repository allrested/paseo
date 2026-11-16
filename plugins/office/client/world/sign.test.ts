import { expect, test } from "vitest";
import { SIGN, drawSign, fitName } from "../../vendor/my-office/src/office/paseo-sign.js";

// A letter is half its type size wide: enough to say when a name fits.
const measure = (text: string, size: number) => text.length * size * 0.5;
/** The sign's width less where the name starts and the margin at its end. */
const ROOM = 724;

test("a short name is drawn at upstream's size", () => {
  expect(fitName(measure, "Paseo", ROOM)).toEqual({ size: 92, text: "Paseo" });
});

test("a longer name is drawn smaller, as large as fits", () => {
  // 20 letters at 72: 720 wide. At 76 it would be 760.
  expect(fitName(measure, "Flavours Engineering", ROOM)).toEqual({
    size: 72,
    text: "Flavours Engineering",
  });
});

test("a name too long for the smallest type ends in an ellipsis", () => {
  const fitted = fitName(measure, "A".repeat(40), ROOM);
  expect(fitted).toEqual({ size: 48, text: `${"A".repeat(29)}…` });
  expect(measure(fitted.text, fitted.size)).toBeLessThanOrEqual(ROOM);
});

test("a name is cut by whole characters, never inside one", () => {
  const fitted = fitName(measure, "Acme Robotics and Automation🚀🚀", ROOM);
  // A lone half of a surrogate pair draws as a broken glyph.
  expect(fitted.text).not.toMatch(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/,
  );
  expect(fitted.text.endsWith("…")).toBe(true);
  expect(measure(fitted.text, fitted.size)).toBeLessThanOrEqual(ROOM);
});

/** A 2D context that keeps what was drawn on it and measures as `measure` does. */
function fakeContext() {
  const calls: unknown[][] = [];
  const g = {
    font: "",
    fillStyle: "",
    textBaseline: "",
    fillRect: (...args: unknown[]) => void calls.push(["fillRect", g.fillStyle, ...args]),
    drawImage: (...args: unknown[]) => void calls.push(["drawImage", ...args]),
    fillText: (...args: unknown[]) => void calls.push(["fillText", g.font, ...args]),
    measureText: (text: string) => ({
      width: measure(text, Number(/(\d+)px/.exec(g.font)?.[1] ?? 0)),
    }),
  };
  return { g, calls };
}

test("without a logo the sign has the scene's mark and then the name", () => {
  const { g, calls } = fakeContext();
  let marks = 0;
  drawSign(g, SIGN.width, SIGN.height, {
    name: "Paseo",
    logo: null,
    mark: () => void (marks += 1),
  });
  expect(marks).toBe(1);
  expect(calls[0]).toEqual(["fillRect", "#1C2620", 0, 0, 1024, 220]);
  expect(calls.some(([kind]) => kind === "drawImage")).toBe(false);
  expect(calls.at(-1)).toEqual([
    "fillText",
    '800 92px "Be Vietnam Pro", system-ui, sans-serif',
    "Paseo",
    260,
    114,
  ]);
});

test("a logo is fitted into the mark's square, in place of the mark", () => {
  const { g, calls } = fakeContext();
  const logo = { width: 400, height: 200 };
  let marks = 0;
  drawSign(g, SIGN.width, SIGN.height, { name: "Flavours", logo, mark: () => void (marks += 1) });
  expect(marks).toBe(0);
  expect(calls.find(([kind]) => kind === "drawImage")).toEqual([
    "drawImage",
    logo,
    75.5,
    72.75,
    149,
    74.5,
  ]);
});

test("a logo that has no size of its own leaves the mark", () => {
  const { g, calls } = fakeContext();
  let marks = 0;
  drawSign(g, SIGN.width, SIGN.height, {
    name: "Flavours",
    logo: { width: 0, height: 0 },
    mark: () => void (marks += 1),
  });
  expect(marks).toBe(1);
  expect(calls.some(([kind]) => kind === "drawImage")).toBe(false);
});
