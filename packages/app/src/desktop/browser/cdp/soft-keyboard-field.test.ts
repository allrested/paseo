/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CdpBrowserViewInput } from "@getpaseo/protocol/browser-automation/cdp-view-schemas";
import { attachSoftKeyboardField } from "./soft-keyboard-field";

describe("attachSoftKeyboardField", () => {
  let field: HTMLTextAreaElement;
  let frame: HTMLDivElement;
  let other: HTMLInputElement;
  let on: boolean;
  let changes: boolean[];
  let sent: CdpBrowserViewInput[];
  let detach: () => void;

  beforeEach(() => {
    frame = document.createElement("div");
    frame.tabIndex = 0;
    field = document.createElement("textarea");
    other = document.createElement("input");
    document.body.append(frame, field, other);
    on = false;
    changes = [];
    sent = [];
    const setOn = (next: boolean) => {
      on = next;
      changes.push(next);
    };
    ({ detach } = attachSoftKeyboardField({
      field,
      frame,
      send: (input) => sent.push(input),
      isOn: () => on,
      turnOn: () => setOn(true),
      turnOff: () => setOn(false),
    }));
  });
  afterEach(() => {
    detach();
    document.body.replaceChildren();
  });

  it("turns on when the field gets focus back without a press", () => {
    // The browser window lost focus with the keyboard on, then restored focus to the field.
    field.focus();
    expect(document.activeElement).toBe(field);
    expect(changes).toEqual([true]);
    expect(on).toBe(true);
  });

  it("turns off when the field loses focus, and ends an open composition", () => {
    field.focus();
    field.dispatchEvent(new CompositionEvent("compositionstart"));
    field.dispatchEvent(new CompositionEvent("compositionupdate", { data: "he" }));
    field.value = "he";
    expect(sent).toEqual([{ kind: "text", text: "he" }]);
    other.focus();
    expect(changes).toEqual([true, false]);
    expect(field.value).toBe("");
    // The composition was reset: its end does not commit the rest of the word into the page.
    field.dispatchEvent(new CompositionEvent("compositionend", { data: "hello" }));
    expect(sent).toEqual([{ kind: "text", text: "he" }]);
  });

  it("stays on when a tap moves focus to the frame, and gives focus back to the field", () => {
    field.focus();
    frame.focus();
    expect(document.activeElement).toBe(field);
    expect(on).toBe(true);
    expect(changes.every((value) => value)).toBe(true);
  });

  it("does not report a change for focus it already shows", () => {
    on = true;
    field.focus();
    expect(changes).toEqual([]);
  });
});
