import { describe, expect, test } from "vitest";
import { dispatchViewInput } from "./view-input.js";

async function sent(input: Parameters<typeof dispatchViewInput>[1]) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  await dispatchViewInput(async (method, params) => void calls.push([method, params]), input);
  return calls;
}

describe("dispatchViewInput", () => {
  test("mouse", async () => {
    expect(
      await sent({
        kind: "mouse",
        type: "down",
        x: 10.5,
        y: 20,
        button: "left",
        buttons: 1,
        clickCount: 2,
        modifiers: 8,
      }),
    ).toEqual([
      [
        "Input.dispatchMouseEvent",
        {
          type: "mousePressed",
          x: 10.5,
          y: 20,
          button: "left",
          buttons: 1,
          clickCount: 2,
          modifiers: 8,
        },
      ],
    ]);
    expect(
      (
        await sent({
          kind: "mouse",
          type: "move",
          x: 1,
          y: 2,
          button: "none",
          buttons: 0,
          clickCount: 0,
          modifiers: 0,
        })
      )[0][1].type,
    ).toBe("mouseMoved");
    expect(
      (
        await sent({
          kind: "mouse",
          type: "up",
          x: 1,
          y: 2,
          button: "left",
          buttons: 0,
          clickCount: 1,
          modifiers: 0,
        })
      )[0][1].type,
    ).toBe("mouseReleased");
  });

  test("wheel", async () => {
    expect(await sent({ kind: "wheel", x: 5, y: 6, deltaX: 0, deltaY: 120, modifiers: 0 })).toEqual(
      [
        [
          "Input.dispatchMouseEvent",
          { type: "mouseWheel", x: 5, y: 6, deltaX: 0, deltaY: 120, modifiers: 0 },
        ],
      ],
    );
  });

  test("a key with text is a key down that types; one without is a raw key down", async () => {
    expect(
      await sent({ kind: "key", type: "down", key: "a", code: "KeyA", text: "a", modifiers: 0 }),
    ).toEqual([
      [
        "Input.dispatchKeyEvent",
        {
          type: "keyDown",
          key: "a",
          code: "KeyA",
          windowsVirtualKeyCode: 65,
          text: "a",
          modifiers: 0,
        },
      ],
    ]);
    expect(
      await sent({ kind: "key", type: "down", key: "ArrowDown", code: "ArrowDown", modifiers: 2 }),
    ).toEqual([
      [
        "Input.dispatchKeyEvent",
        {
          type: "rawKeyDown",
          key: "ArrowDown",
          code: "ArrowDown",
          windowsVirtualKeyCode: 40,
          modifiers: 2,
        },
      ],
    ]);
    expect(await sent({ kind: "key", type: "up", key: "a", code: "KeyA", modifiers: 0 })).toEqual([
      [
        "Input.dispatchKeyEvent",
        { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 0 },
      ],
    ]);
  });

  test("Enter gets its carriage return even when the client sent no text", async () => {
    expect(
      (await sent({ kind: "key", type: "down", key: "Enter", code: "Enter", modifiers: 0 }))[0][1],
    ).toMatchObject({
      type: "keyDown",
      text: "\r",
      windowsVirtualKeyCode: 13,
    });
  });

  test("text is inserted", async () => {
    expect(await sent({ kind: "text", text: "héllo" })).toEqual([
      ["Input.insertText", { text: "héllo" }],
    ]);
  });
});
