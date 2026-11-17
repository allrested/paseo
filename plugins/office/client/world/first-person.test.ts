// @vitest-environment jsdom
// Upstream's walk (interact/first-person.js) in Paseo's page: the bar's overlay is the real one, the
// renderer, the rig, the props and the people are stood in with the little the walk reads.
import { beforeEach, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  workers: new Map<string, Record<string, unknown>>(),
  sessions: new Map<string, Record<string, unknown>>(),
  openSession: vi.fn(),
  petCat: vi.fn(),
  activateProp: vi.fn(),
  props: new Map<string, Record<string, unknown>>(),
}));

vi.mock("../../vendor/my-office/src/office/scene/renderer.js", async () => {
  const THREE = await import("../../vendor/my-office/three/three.module.min.js");
  return {
    camera: new THREE.OrthographicCamera(-1, 1, 1, -1),
    controls: {
      enabled: true,
      target: new THREE.Vector3(),
      minZoom: 0.5,
      maxZoom: 3.4,
      update() {},
    },
    fpCam: new THREE.PerspectiveCamera(70, 1, 0.05, 240),
    renderPass: { camera: null },
    renderer: { domElement: document.createElement("canvas") },
    resize() {},
    scene: new THREE.Scene(),
  };
});
vi.mock("../../vendor/my-office/src/office/people/chibi-rig.js", async () => {
  const THREE = await import("../../vendor/my-office/three/three.module.min.js");
  return {
    makeChibi: () => ({ root: new THREE.Group(), P: { D: { hipY: 0.6, headY: 0.9, sitY: 0.1 } } }),
    chibiPose: () => ({}),
    applyChibiPose: () => 0,
  };
});
vi.mock("../../vendor/my-office/src/office/world/props/cat.js", () => ({
  cat: { pos: { x: 100, y: 100 } },
  petCat: h.petCat,
}));
vi.mock("../../vendor/my-office/src/office/people/navigation.js", () => ({
  DOOR_IN: { x: -6.5, z: 3 },
  DOOR_OUT: { x: -8, z: 3 },
}));
vi.mock("../../vendor/my-office/src/office/world/entrance.js", () => ({
  DZ: 0,
  LIFT_X: -7.5,
  lift: null,
}));
// A live city outside, with a street and a way out to it: upstream's street() would return it.
vi.mock("../../vendor/my-office/src/office/world/backdrops/index.js", () => {
  const city = { live: { street: { exits: () => [{ x: -9, z: 3, n: [-1, 0] }] } } };
  return { THEME: city, THEMES: { city } };
});
vi.mock("../../vendor/my-office/src/office/ui/activity.js", () => ({ toast() {} }));
vi.mock("../../vendor/my-office/src/office/audio/sfx.js", () => ({ sfx: { play() {} } }));
vi.mock("../../vendor/my-office/src/office/people/workers.js", () => ({
  sessions: h.sessions,
  workers: h.workers,
  subs: new Map(),
}));
vi.mock("../../vendor/my-office/src/office/ui/session-drawer.js", () => ({
  openSession: h.openSession,
  closeSession() {},
}));
vi.mock("../../vendor/my-office/src/office/interact/props.js", () => ({
  PROPS: h.props,
  activateProp: h.activateProp,
  propHint: () => "",
}));
vi.mock("../../vendor/my-office/src/office/core/loop.js", () => ({ focusTarget: null }));
vi.mock("../../vendor/my-office/src/office/paseo-host.js", () => ({ host: { toast() {} } }));

const { build } = await import("../../vendor/my-office/src/office/ui/camera-bar.js");
// (read through the module: setup() gives `fp` a new object, so a copy taken at import goes stale)
const walk = await import("../../vendor/my-office/src/office/interact/first-person.js");
const { fpUpdate, setup } = walk;

const key = (code: string, type = "keydown") =>
  document.dispatchEvent(new KeyboardEvent(type, { code }));
const page = (id: string) => document.getElementById(id) as HTMLElement;

/** A person two metres ahead of where the walk starts, facing along +x. */
function seatAhead(): void {
  h.sessions.set("ada", { name: "Ada" });
  h.workers.set("ada", {
    id: "ada",
    pos: { x: walk.fp.pos.x + 1.5, y: walk.fp.pos.y },
    root: { visible: true },
    cfg: { name: "Ada" },
    anim: "type",
    sub: false,
  });
}

beforeEach(() => {
  document.body.innerHTML = '<div id="stage-wrap"><div id="stage"></div></div>';
  h.workers.clear();
  h.sessions.clear();
  h.openSession.mockReset();
  h.petCat.mockReset();
  h.activateProp.mockReset();
  h.props.clear();
  build();
  setup();
});

test("the Walk in button enters, shows the overlay and presses itself; Exit leaves", () => {
  page("btn-fp").click();
  expect(walk.fp.on).toBe(true);
  expect(page("fp-hud").hidden).toBe(false);
  expect(page("btn-fp").getAttribute("aria-pressed")).toBe("true");
  expect(document.body.classList.contains("is-fp")).toBe(true);

  page("fp-exit").click();
  expect(walk.fp.on).toBe(false);
  expect(page("fp-hud").hidden).toBe(true);
  expect(page("btn-fp").getAttribute("aria-pressed")).toBe("false");
});

test("W walks forward and Shift runs faster", () => {
  page("btn-fp").click();
  const x0 = walk.fp.pos.x;
  key("KeyW");
  fpUpdate(0.5);
  const walked = walk.fp.pos.x - x0;
  expect(walked).toBeGreaterThan(0.9);
  key("ShiftLeft");
  fpUpdate(0.5);
  expect(walk.fp.pos.x - x0 - walked).toBeGreaterThan(walked);
  page("fp-exit").click();
});

test("keys do nothing while a text field has them", () => {
  page("btn-fp").click();
  const input = document.createElement("input");
  document.body.append(input);
  const x0 = walk.fp.pos.x;
  input.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW", bubbles: true }));
  fpUpdate(0.5);
  expect(walk.fp.pos.x).toBe(x0);
  page("fp-exit").click();
});

test("E by a person opens their session and keeps walking", () => {
  page("btn-fp").click();
  seatAhead();
  fpUpdate(0.016);
  expect(page("fp-near").hidden).toBe(false);
  expect(page("fp-near").textContent).toContain("Ada");

  key("KeyE");
  expect(h.openSession).toHaveBeenCalledWith("ada", { open: true });
  expect(walk.fp.on).toBe(true);
  page("fp-exit").click();
});

test("the door has no E action: the street is not taken", () => {
  // the door, within reach ahead of where the walk starts, with a city outside it
  const door = {
    id: "door",
    name: "Door",
    meshes: [],
    box: { min: { x: -5.0, z: 2.6 }, max: { x: -4.9, z: 3.4 } },
  };
  h.props.set("door", door);
  page("btn-fp").click();
  fpUpdate(0.016);
  expect(page("fp-near").hidden).toBe(false);
  expect(page("fp-near").textContent).toContain("Door");
  expect(page("fp-near").textContent).not.toContain("street");

  key("KeyE");
  expect(h.activateProp).toHaveBeenCalledWith(door);
  expect(h.openSession).not.toHaveBeenCalled();
  // (toStreet would have started its fade to black at once)
  expect(document.querySelector(".fp-fade")?.classList.contains("on")).toBe(false);
  expect(walk.fp.street).toBe(false);
  page("fp-exit").click();
});
