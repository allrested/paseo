// @vitest-environment jsdom
// The picking of people and furniture (ui/whiteboard.js): a press or a hover on the floor casts its
// ray through the camera you see the floor through. The renderer, the props and the walk are stood
// in with the little the picking reads; the ray is the real one.
import { beforeEach, expect, test, vi } from "vitest";
import { state } from "../../vendor/my-office/src/office/core/state.js";

const h = vi.hoisted(() => ({
  closePlace: vi.fn(),
  /** The walk's state: a test turns `on` to be walking. */
  fp: { on: false },
}));

vi.mock("../../vendor/my-office/src/office/scene/renderer.js", async () => {
  const THREE = await import("../../vendor/my-office/three/three.module.min.js");
  const canvas = document.createElement("canvas");
  // (jsdom lays nothing out, and has no DOMRect to build one with)
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect;
  return {
    camera: new THREE.OrthographicCamera(-20, 20, 15, -15, 0.1, 200),
    fpCam: new THREE.PerspectiveCamera(70, 800 / 600, 0.05, 240),
    renderer: { domElement: canvas },
  };
});
vi.mock("../../vendor/my-office/src/office/world/furniture/board.js", () => ({
  boardFace: { material: {} },
}));
vi.mock("../../vendor/my-office/src/office/people/director.js", () => ({ director: null }));
vi.mock("../../vendor/my-office/src/office/ui/session-drawer.js", () => ({ toggleSession() {} }));
vi.mock("../../vendor/my-office/src/office/ui/mac-drawer.js", () => ({ openMac() {} }));
vi.mock("../../vendor/my-office/src/office/interact/props.js", () => ({
  activateProp() {},
  buildProps() {},
  pickPerson: () => null,
  pickProp: () => null,
  setHoverProp() {},
}));
vi.mock("../../vendor/my-office/src/office/people/errands.js", () => ({ lookUp() {} }));
vi.mock("../../vendor/my-office/src/office/interact/place-cards.js", () => ({
  closePlace: h.closePlace,
  openPlace() {},
}));
vi.mock("../../vendor/my-office/src/office/paseo-host.js", () => ({
  host: { board() {}, boardRows: () => [], machine: null },
}));
vi.mock("../../vendor/my-office/src/office/interact/first-person.js", () => ({ fp: h.fp }));

const { ray, setup } = await import("../../vendor/my-office/src/office/ui/whiteboard.js");
const { camera, fpCam, renderer } =
  await import("../../vendor/my-office/src/office/scene/renderer.js");

const canvas = renderer.domElement as HTMLCanvasElement;
setup();

/** A pointer event at the middle of the floor; jsdom has no PointerEvent, so it is a mouse event with a pointer type. */
function pointer(type: string): Event {
  return Object.assign(new MouseEvent(type, { clientX: 400, clientY: 300, buttons: 0 }), {
    pointerType: "mouse",
  });
}

/** A press without a drag: what the picking takes for a click. */
function press(): void {
  canvas.dispatchEvent(pointer("pointerdown"));
  canvas.dispatchEvent(pointer("pointerup"));
}

/** A mouse moving over the floor, past the hover's 60 ms pause. */
function hover(): void {
  state.hoverAt = -1e9;
  canvas.dispatchEvent(pointer("pointermove"));
}

beforeEach(() => {
  h.fp.on = false;
  h.closePlace.mockReset();
  ray.camera = null;
});

test("while walking, a press picks through the walk's camera", () => {
  h.fp.on = true;
  press();
  expect(h.closePlace).toHaveBeenCalledTimes(1);
  expect(ray.camera).toBe(fpCam);
});

test("while walking, a hover picks through the walk's camera", () => {
  h.fp.on = true;
  hover();
  expect(ray.camera).toBe(fpCam);
});

test("not walking, a press and a hover pick through the floor's camera", () => {
  press();
  expect(ray.camera).toBe(camera);
  ray.camera = null;
  hover();
  expect(ray.camera).toBe(camera);
});
