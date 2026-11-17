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
  exitFp: vi.fn(),
  /** The walk's state: a test turns `on` to be walking. */
  fp: { on: false },
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
    fpCam: { fov: 70, updateProjectionMatrix() {} },
  };
});
vi.mock("../../vendor/my-office/src/office/core/loop.js", () => ({
  focusTarget: { set: h.set, copy: h.copy },
}));
vi.mock("../../vendor/my-office/src/office/ui/session-drawer.js", () => ({
  closeSession: h.closeSession,
}));
vi.mock("../../vendor/my-office/src/office/paseo-host.js", () => ({ host: { toast: h.toast } }));
vi.mock("../../vendor/my-office/src/office/interact/first-person.js", () => ({
  floorBounds: () => ({ x0: -7.85, x1: 15.3, z0: -7.85, z1: 11.3 }),
  fp: h.fp,
  exitFp: h.exitFp,
}));

import { build, goView, setView, setup } from "../../vendor/my-office/src/office/ui/camera-bar.js";

const { camera, controls, fpCam } =
  await import("../../vendor/my-office/src/office/scene/renderer.js");

/** The document outlives each test's page: the listeners setup() puts on it are taken off after the test. */
const onDocument = vi.spyOn(document, "addEventListener");

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

/** The pointer media query: `change(fine)` is the device's pointer changing. */
function pointer(fine: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: fine,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
  };
  vi.stubGlobal("matchMedia", () => query);
  return {
    change(next: boolean) {
      query.matches = next;
      for (const listener of listeners) listener();
    },
  };
}

/**
 * Builds the bar and wires it, as paseo-entry.js does; `fullscreen` is what the frame's browser offers,
 * `fine` whether its pointer is fine (a mouse). Returns the pointer, to change it.
 */
function open({ fullscreen = true, refuse = false, fine = true } = {}) {
  Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: fullscreen });
  document.documentElement.requestFullscreen = refuse
    ? vi.fn(() => Promise.reject(new Error("not allowed")))
    : vi.fn(() => Promise.resolve());
  const handle = pointer(fine);
  build();
  setup();
  return handle;
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
  h.fp.on = false;
  h.exitFp.mockReset();
  fpCam.fov = 70;
  document.body.innerHTML = '<div id="stage-wrap"><div id="stage"></div></div>';
});

afterEach(() => {
  for (const [type, listener, options] of onDocument.mock.calls) {
    document.removeEventListener(type, listener, options);
  }
  onDocument.mockClear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (document.documentElement as { requestFullscreen?: unknown }).requestFullscreen;
});

test("the bar has its nine controls with their labels", () => {
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
    "Walk in",
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

test("every element first-person.js wires is built before the modules run", () => {
  // first-person.js's setup reads these ids and holds no guard: a missing one throws before the office draws.
  build();
  for (const id of ["btn-fp", "fp-hud", "fp-near", "fp-exit", "fp-joy"]) {
    expect(document.getElementById(id), id).not.toBeNull();
  }
  expect(page("fp-hud").hidden).toBe(true);
  expect(page("btn-fp").getAttribute("aria-pressed")).toBe("false");
  expect(page("btn-fp").getAttribute("title")).toBe("Walk in");
});

test("the overlay's style keeps upstream's light ink and hides the chips while walking", () => {
  build();
  const css = [...document.querySelectorAll("style")].map((s) => s.textContent).join("\n");
  expect(css).toMatch(/\.fp-help \{[^}]*color: #8D97AA;/);
  expect(css).toMatch(/\.is-fp \.zone/);
  expect(css).toMatch(/\.bil-hud \{/);
});

test("while the incident banner shows, the walk's help line sits under it above 520 px", () => {
  // The banner (paseo-style.js `.incident`) is at the stage's top, 12 px down and about 30 px tall;
  // at 520 px and narrower the help line is at 56 px already.
  build();
  const css = [...document.querySelectorAll("style")].map((s) => s.textContent).join("\n");
  expect(css).toMatch(
    /@media \(min-width: 521px\) \{ #stage-wrap:has\(> #incident:not\(\[hidden\]\)\) \.fp-help \{ top: 52px; \} \}/,
  );
});

test("the bar's text stays light on its dark track in either theme", () => {
  // Paseo's page colours its text with the theme's foreground, near-black in the light theme: the
  // bar sets upstream's light ink itself so nothing in it inherits that.
  build();
  const css = [...document.querySelectorAll("style")].map((s) => s.textContent).join("\n");
  expect(css).toMatch(/\.toolbar \{[^}]*color: #E8ECF4;/);
});

test("a zoom clears the pressed view, and a resize then does not refit", () => {
  open();
  click("#zoom-in");
  click("#zoom-in");
  expect(pressed()).toEqual([]);
  const zoomed = state.zoomGoal;
  const fitted = h.copy.mock.calls.length;
  resized?.();
  expect(h.copy.mock.calls.length).toBe(fitted);
  expect(state.zoomGoal).toBe(zoomed);

  click("[data-view=home]");
  click("#zoom-out");
  expect(pressed()).toEqual([]);
});

test("a start in a frame with no size still fits the floor, so the views and the percent read from it", () => {
  // scene/renderer.js's resize sizes a stage of 0 x 0 as 1 x 1 (`clientWidth || 1`): a square frustum,
  // never an empty one.
  const frustum = [camera.left, camera.right, camera.top, camera.bottom] as const;
  const s = Math.max(8.8, 12 / 1);
  camera.left = -s;
  camera.right = s;
  camera.top = s;
  camera.bottom = -s;
  try {
    open();
    const fitted = camera.zoom;
    expect(fitted).toBeGreaterThan(controls.minZoom);
    vi.advanceTimersByTime(200);
    expect(page("zoom-val").textContent).toBe("100%");
    click("[data-view=desks]");
    expect(state.zoomGoal).toBeCloseTo(Math.min(controls.maxZoom, fitted * 1.9));
  } finally {
    [camera.left, camera.right, camera.top, camera.bottom] = frustum;
    camera.updateProjectionMatrix();
  }
});

/** The text of the style blocks the page has. */
function styles(): string {
  return [...document.querySelectorAll("style")].map((s) => s.textContent).join("\n");
}

test("the tools' tooltips are not drawn in a frame too narrow to hold the last one", () => {
  // At 390 px the last tool's name ran past the frame's right edge.
  build();
  expect(styles()).toMatch(
    /@media \(max-width: 520px\) \{[^{]*\.tb-zoom button::after, \.tb-full::after \{ display: none; \}/,
  );
});

/** The rules inside the style's `@media (max-width: <px>px)` blocks, in order. */
function narrow(px: number): string {
  const css = styles();
  const head = `@media (max-width: ${px}px) {`;
  const found: string[] = [];
  for (let at = css.indexOf(head); at !== -1; at = css.indexOf(head, at + 1)) {
    let depth = 1;
    let end = at + head.length;
    for (; depth > 0 && end < css.length; end += 1) {
      if (css[end] === "{") depth += 1;
      if (css[end] === "}") depth -= 1;
    }
    found.push(css.slice(at + head.length, end - 1));
  }
  return found.join("\n");
}

test("from 720 px down Walk in and the views keep their names hidden, with upstream's narrower padding", () => {
  // At 530 px the bar with both names ran past the frame's right edge, and a view's name sliding out on
  // hover or focus still did (upstream's styles/stage.css, its 720 px rule).
  build();
  expect(narrow(720)).toContain(
    ".tb-fp span:last-child, .seg-btn > span:last-child { display: none !important; }",
  );
  expect(narrow(720)).toContain(".tb-fp { padding: 0 11px; }");
  expect(narrow(720)).toContain(
    '.seg-btn, .seg-btn:hover, .seg-btn[aria-pressed="true"] { padding: 0 10px; }',
  );
});

test("at 520 px and narrower the bar's buttons and groups sit closer, so Walk in still fits at 390 px", () => {
  // At 390 px with a mouse, Walk in still ran 30 px past the frame's right edge with the 720 px rule alone.
  build();
  expect(narrow(520)).toContain(".toolbar { gap: 4px; }");
  expect(narrow(520)).toContain(
    '.seg-btn, .seg-btn:hover, .seg-btn:focus-visible, .seg-btn[aria-pressed="true"] { padding: 0 7px; }',
  );
  expect(narrow(520)).toContain(".tb-zoom button, .tb-full { width: 30px; }");
});

test("photo mode's bar keeps upstream's focus ring, its round exit, and drops the hint on a phone", () => {
  build();
  const css = styles();
  expect(css).toContain(
    ".pb-tgl:focus-visible, .pb-seg button:focus-visible, .pb-shoot:focus-visible, .pb-exit:focus-visible { outline: 2px solid #F2B33D; outline-offset: 2px; }",
  );
  expect(css).toContain(".pb-exit { display: inline-grid; place-items: center; padding: 7px; }");
  expect(css).toContain(
    "@media (max-width: 720px) { .photo-hint { display: none; } .pb-sep { display: none; } }",
  );
});

test("Walk in is shown for a fine pointer and hidden for a coarse one, and follows a change", () => {
  const fine = open({ fine: false });
  expect(page("btn-fp").hidden).toBe(true);
  fine.change(true);
  expect(page("btn-fp").hidden).toBe(false);
  fine.change(false);
  expect(page("btn-fp").hidden).toBe(true);
});

test("a view press leaves walk-in first", () => {
  open();
  h.fp.on = true;
  click("[data-view=desks]");
  expect(h.exitFp).toHaveBeenCalledTimes(1);
});

test("zoom while walking changes the field of view by 8, within 40 and 90", () => {
  open();
  h.fp.on = true;
  click("#zoom-in");
  expect(fpCam.fov).toBe(62);
  for (let i = 0; i < 6; i += 1) click("#zoom-in");
  expect(fpCam.fov).toBe(40);
  for (let i = 0; i < 8; i += 1) click("#zoom-out");
  expect(fpCam.fov).toBe(90);
  expect(state.zoomGoal).toBeNull();
});

test("the percent while walking is the field of view's zoom over 70", () => {
  open();
  h.fp.on = true;
  vi.advanceTimersByTime(200);
  expect(page("zoom-val").textContent).toBe("100%");
  click("#zoom-in");
  vi.advanceTimersByTime(200);
  expect(page("zoom-val").textContent).toBe("113%");
});

test("Escape leaves walk-in, but not while the place card is open", () => {
  open();
  document.body.insertAdjacentHTML("beforeend", '<div id="plc"></div>');
  h.fp.on = true;
  page("plc").hidden = false;
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(h.exitFp).not.toHaveBeenCalled();

  page("plc").hidden = true;
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(h.exitFp).toHaveBeenCalledTimes(1);
});

test("Escape does nothing while not walking", () => {
  open();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(h.exitFp).not.toHaveBeenCalled();
});
