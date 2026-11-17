// @vitest-environment jsdom
// The camera toolbar (ui/camera-bar.js): the bar it builds, its views, the zoom's limit, full screen
// and photo mode's bar. The renderer, the loop and the session drawer are stood in with plain
// objects, as entry.test.ts stands them in: what the bar reads of the world is a camera with a zoom,
// the controls' limits, and a focus target the loop would glide to.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { state } from "../../vendor/my-office/src/office/core/state.js";

const h = vi.hoisted(() => ({
  /** What the bar did, in order: the chosen person closing before the camera flies, for one. */
  calls: [] as string[],
  closeSession: vi.fn(),
  toast: vi.fn(),
  set: vi.fn(),
  copy: vi.fn(),
}));

vi.mock("../../vendor/my-office/src/office/scene/renderer.js", async () => {
  // A real orthographic camera: fitFloor projects the floor's corners through it.
  const THREE = await import("../../vendor/my-office/three/three.module.min.js");
  const camera = new THREE.OrthographicCamera(-20, 20, 15, -15, 0.1, 200);
  camera.position.set(20, 20, 20);
  camera.zoom = 1;
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return {
    camera,
    controls: { target: new THREE.Vector3(0, 0, 0), minZoom: 0.5, maxZoom: 3.4, update() {} },
  };
});
vi.mock("../../vendor/my-office/src/office/core/loop.js", () => ({
  focusTarget: { set: h.set, copy: h.copy },
}));
vi.mock("../../vendor/my-office/src/office/ui/session-drawer.js", () => ({
  closeSession: h.closeSession,
}));
vi.mock("../../vendor/my-office/src/office/paseo-host.js", () => ({ host: { toast: h.toast } }));

import { build, goView, setView, setup } from "../../vendor/my-office/src/office/ui/camera-bar.js";

const { camera, controls } = await import("../../vendor/my-office/src/office/scene/renderer.js");

/** The frame's browser: no ResizeObserver, so the bar's observer is this one, and a test can resize. */
let resized: (() => void) | null = null;
class ResizeObserverStub {
  constructor(callback: () => void) {
    resized = callback;
  }
  observe() {}
  disconnect() {}
}

/** An element of the bar the page built. */
function page(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`The bar has no #${id}`);
  return found;
}

function click(selector: string): void {
  const found = document.querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`The bar has no ${selector}`);
  found.click();
}

/** The views pressed now, in the order they are in the bar. */
function pressed(): (string | undefined)[] {
  return [...document.querySelectorAll<HTMLElement>(".seg-btn[aria-pressed='true']")].map(
    (b) => b.dataset.view,
  );
}

/** Builds the bar and wires it, as paseo-entry.js does; `fullscreen` is what the frame's browser offers. */
function open({ fullscreen = true, refuse = false } = {}): void {
  Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: fullscreen });
  document.documentElement.requestFullscreen = refuse
    ? vi.fn(() => Promise.reject(new Error("not allowed")))
    : vi.fn(() => Promise.resolve());
  build();
  setup();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  resized = null;
  h.calls.length = 0;
  h.closeSession.mockReset().mockImplementation(() => {
    h.calls.push("close");
  });
  h.set.mockReset().mockImplementation(() => {
    h.calls.push("set");
  });
  h.copy.mockReset();
  h.toast.mockReset();
  state.selectedId = null;
  state.zoomGoal = null;
  camera.zoom = 1;
  document.body.innerHTML = '<div id="stage-wrap"><div id="stage"></div></div>';
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (document.documentElement as { requestFullscreen?: unknown }).requestFullscreen;
});

test("the bar has its eight controls with their labels", () => {
  open();

  expect(
    [...document.querySelectorAll(".toolbar button")].map((b) => b.getAttribute("aria-label")),
  ).toEqual([
    "Overview",
    "Desks",
    "Meeting room",
    "Servers",
    "Zoom out",
    "Zoom in",
    "Full screen",
    "Photo mode",
  ]);
  expect(document.querySelector(".toolbar")?.getAttribute("aria-label")).toBe("View");
});

test("Overview is pressed at the start, and a drag clears it", () => {
  open();
  expect(pressed()).toEqual(["home"]);

  // (core/loop.js clears the view on the controls' 'start': a drag of the floor)
  setView(null);
  expect(pressed()).toEqual([]);
});

test("Desks flies to upstream's place at 1.9 times the fitted zoom", () => {
  open();
  const fitted = camera.zoom;
  click("[data-view=desks]");

  expect(h.set).toHaveBeenLastCalledWith(2.3, 0.6, 3.6);
  expect(state.zoomGoal).toBeCloseTo(fitted * 1.9);
  expect(pressed()).toEqual(["desks"]);
});

test("a view closes the chosen person first", () => {
  open();
  state.selectedId = "a";
  click("[data-view=meeting]");

  expect(h.calls[0]).toBe("close");
  expect(h.calls).toContain("set");
  expect(h.closeSession).toHaveBeenCalledTimes(1);
  expect(h.set).toHaveBeenLastCalledWith(-1.2, 0.6, -5.4);
});

test("Overview flies back to the fitted floor", () => {
  open();
  const fitted = camera.zoom;
  click("[data-view=desks]");
  click("[data-view=home]");

  expect(state.zoomGoal).toBeNull();
  expect(camera.zoom).toBeCloseTo(fitted);
  expect(pressed()).toEqual(["home"]);
});

test("zoom in stops at the limit", () => {
  open();
  state.zoomGoal = controls.maxZoom - 0.01;
  click("#zoom-in");
  expect(state.zoomGoal).toBe(controls.maxZoom);
  click("#zoom-in");
  expect(state.zoomGoal).toBe(controls.maxZoom);
});

test("zoom out stops at its own limit", () => {
  open();
  state.zoomGoal = controls.minZoom + 0.01;
  click("#zoom-out");
  expect(state.zoomGoal).toBe(controls.minZoom);
  click("#zoom-out");
  expect(state.zoomGoal).toBe(controls.minZoom);
});

test("the percent reads 100% on Overview", () => {
  open();
  vi.advanceTimersByTime(200);
  expect(page("zoom-val").textContent).toBe("100%");
});

test("full screen is hidden where the browser has it off", () => {
  open({ fullscreen: false });
  expect(page("btn-full").hidden).toBe(true);
});

test("full screen is offered where the browser has it", () => {
  open();
  expect(page("btn-full").hidden).toBe(false);
});

test("a refused full screen says so", async () => {
  open({ refuse: true });
  page("btn-full").click();
  await Promise.resolve();
  await Promise.resolve();

  expect(h.toast).toHaveBeenCalledWith("This browser won't go full screen.");
});

test("a resize refits only on Overview", () => {
  open();
  click("[data-view=desks]");
  const flown = h.copy.mock.calls.length;
  resized?.();
  expect(h.copy.mock.calls.length).toBe(flown);

  click("[data-view=home]");
  const fitted = h.copy.mock.calls.length;
  resized?.();
  expect(h.copy.mock.calls.length).toBe(fitted + 1);
});

test("goView presses the view it was given", () => {
  open();
  goView("server");

  expect(h.set).toHaveBeenLastCalledWith(-5.6, 1.0, -0.6);
  expect(pressed()).toEqual(["server"]);
});

test("photo mode's bar is in the page, hidden, with its own controls", () => {
  open();

  expect(page("photo-bar").hidden).toBe(true);
  expect(
    [...document.querySelectorAll(".photo-bar [data-ph-size]")].map((b) => b.textContent),
  ).toEqual(["Screen", "Full HD", "4K"]);
});

test("every element ui/photo.js wires is built before the modules run", () => {
  // ui/photo.js's setup reads these ids and holds no guard: a missing one throws before the office draws.
  build();
  for (const id of ["btn-photo", "ph-exit", "ph-shoot", "ph-names", "ph-mark", "photo-bar"]) {
    expect(document.getElementById(id), id).not.toBeNull();
  }
});

test("the bar's text stays light on its dark track in either theme", () => {
  // Paseo's page colours its text with the theme's foreground, near-black in the light theme: the
  // bar sets upstream's light ink itself so nothing in it inherits that.
  build();
  const css = [...document.querySelectorAll("style")].map((s) => s.textContent).join("\n");
  expect(css).toMatch(/\.toolbar \{[^}]*color: #E8ECF4;/);
});
