// @vitest-environment jsdom
// Photo mode's switch (ui/photo.js): a host that says photo is false has no button and no P key.
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({ host: { photo: true, brandName: "", toast: () => undefined } }));

vi.mock("../../vendor/my-office/src/office/paseo-host.js", () => ({ host: h.host }));
vi.mock("../../vendor/my-office/src/office/core/state.js", () => ({ state: {} }));
vi.mock("../../vendor/my-office/src/office/core/env.js", () => ({
  $: (id: string) => document.getElementById(id),
  stage: document.createElement("div"),
}));
vi.mock("../../vendor/my-office/src/office/scene/renderer.js", () => ({
  SOFTWARE_GL: false,
  camera: {},
  composer: {},
  controls: { update() {} },
  renderer: {},
  resize() {},
  scene: {},
}));
vi.mock("../../vendor/my-office/src/office/people/workers.js", () => ({
  npcs: [],
  subs: new Map(),
  workers: new Map(),
}));
vi.mock("../../vendor/my-office/src/office/interact/first-person.js", () => ({
  exitFp() {},
  fp: { on: false },
}));
vi.mock("../../vendor/my-office/src/office/ui/settings.js", () => ({
  setTimeMode() {},
  syncTimeBtns() {},
}));
vi.mock("../../vendor/my-office/src/office/world/room-update.js", () => ({ night: false }));
vi.mock("../../vendor/my-office/src/office/ui/activity.js", () => ({ toast() {} }));
vi.mock("../../vendor/my-office/src/office/world/pro/pieces.js", () => ({ OFFICE_MARK: "" }));
vi.mock("../../vendor/my-office/src/i18n/index.js", () => ({ t: (key: string) => key }));

import { enterPhoto, setup } from "../../vendor/my-office/src/office/ui/photo.js";

/** The window outlives each test's page: the P key's listener setup() puts on it is taken off after the test. */
const onWindow = vi.spyOn(window, "addEventListener");

afterEach(() => {
  for (const [type, listener, options] of onWindow.mock.calls) {
    window.removeEventListener(type, listener, options);
  }
  onWindow.mockClear();
});

beforeEach(() => {
  document.body.className = "";
  document.body.innerHTML = `
    <button id="btn-photo"></button>
    <div id="photo-bar" hidden>
      <button id="ph-exit"></button><button id="ph-shoot"></button>
      <button id="ph-names"></button><button id="ph-mark"></button>
    </div>`;
});

function pressP(): void {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", bubbles: true }));
}

test("with photo off the button is hidden, P does nothing and the mode cannot be entered", () => {
  h.host.photo = false;
  setup();
  pressP();
  enterPhoto();
  expect(document.getElementById("btn-photo")?.hidden).toBe(true);
  expect(document.getElementById("photo-bar")?.hidden).toBe(true);
  expect(document.body.classList.contains("is-photo")).toBe(false);
});

test("with photo on, the button shows and P opens the bar", () => {
  h.host.photo = true;
  setup();
  pressP();
  expect(document.getElementById("btn-photo")?.hidden).toBe(false);
  expect(document.getElementById("photo-bar")?.hidden).toBe(false);
  expect(document.body.classList.contains("is-photo")).toBe(true);
});
