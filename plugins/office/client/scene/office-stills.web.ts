// Web only: the office's parts as still pictures, drawn with the scene's own meshes. The sheet
// page (render/sheet-page.ts) reads each one off the canvas. Nothing here runs at import time.
import { VIEW_TURN, type Point } from "../layout.js";
import {
  cameraPosition,
  frustumFor,
  pixelsPerUnit,
  type CameraView,
  type Viewport,
} from "./camera.js";
import {
  WHITE,
  applyPalette,
  createLayers,
  createMaterials,
  createRig,
  createSoftTexture,
  ensureCapacity,
  finishLayer,
  lightScene,
  makeLabel,
  place,
  placeLabel,
  writeDesks,
  writeNotes,
  writeRobotFrames,
  writeRooms,
  type Label,
  type Stage,
} from "./office-scene.web.js";
import type { ScenePalette } from "./palette.js";
import {
  DESK_OFFSET_Z,
  deskPlans,
  type RobotFrame,
  type RobotPlan,
  type ScenePlan,
} from "./scene-plan.js";
import type { CameraLike, ColorLike, ThreeModule } from "./three-types.js";

export interface StillFrame {
  view: CameraView;
  /** Screen points. */
  viewport: Viewport;
  /** Picture pixels per screen point. */
  ratio: number;
}

export interface PlateSize {
  /** Screen points. */
  width: number;
  height: number;
}

export interface OfficeStills {
  /** The office, its colours, the camera and the picture's size for every draw after it. */
  set(plan: ScenePlan, palette: ScenePalette, frame: StillFrame): void;
  /** Floors, far walls, boards and their notes, main desks with dark screens. Opaque. */
  backdrop(): void;
  /** Near walls and rails, notes on desks, name plates. On a clear ground. */
  overlay(): void;
  /** One robot at its seat with its desk, screen, glow and shadow. On a clear ground. */
  robot(robot: RobotPlan, motion: RobotFrame): void;
  /** One paper plane over `at`, heading across the screen to the right. On a clear ground. */
  plane(at: Point, height: number): void;
  /**
   * Everything in one draw, as the scene draws it, with these robots: what the parts must add up
   * to. The sheet page never calls it; the fidelity check does.
   */
  whole(robots: readonly { robot: RobotPlan; motion: RobotFrame }[]): void;
  /** Each room's name plate as drawn. */
  plates(): Map<string, PlateSize>;
  dispose(): void;
}

export interface OfficeStillsOptions {
  three: ThreeModule;
  canvas: HTMLCanvasElement;
}

const CLEAR = "#000000";
/** A plane that flies across the screen to the right heads this way over the ground. */
const PLANE_HEADING = Math.atan2(Math.cos(VIEW_TURN), -Math.sin(VIEW_TURN));

export function createOfficeStills({ three, canvas }: OfficeStillsOptions): OfficeStills {
  const renderer = new three.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "low-power",
    preserveDrawingBuffer: true,
  });
  renderer.outputColorSpace = three.SRGBColorSpace;
  renderer.setPixelRatio(1);
  const scene = new three.Scene();
  const ground: ColorLike = new three.Color(WHITE);
  const camera: CameraLike = new three.OrthographicCamera(-1, 1, 1, -1, -200, 400);
  lightScene(three, scene);
  const softTexture = createSoftTexture(three);
  const materials = createMaterials(three, softTexture);
  const world = new three.Group();
  scene.add(world);
  const layers = createLayers(three, world, materials);
  const stage: Stage = {
    three,
    world,
    layers,
    dummy: new three.Object3D(),
    tint: new three.Color(WHITE),
  };
  const rig = createRig(three);
  const labels = new Map<string, Label>();

  let plan: ScenePlan | null = null;
  let palette: ScenePalette | null = null;
  let frame: StillFrame | null = null;
  let size = { width: 0, height: 0 };

  function current(): { plan: ScenePlan; palette: ScenePalette; frame: StillFrame } {
    if (plan === null || palette === null || frame === null) {
      throw new Error("The stills have no office to draw");
    }
    return { plan, palette, frame };
  }

  function dropLabels(): void {
    for (const label of labels.values()) {
      world.remove(label.sprite);
      label.sprite.material.dispose();
      label.texture.dispose();
    }
    labels.clear();
  }

  /** Empties every layer: a draw then writes only what it shows. */
  function empty(): void {
    for (const layer of Object.values(layers)) finishLayer(layer, 0);
    for (const label of labels.values()) world.remove(label.sprite);
  }

  function draw(opaque: boolean): void {
    scene.background = opaque ? ground : null;
    if (!opaque) renderer.setClearColor(CLEAR, 0);
    renderer.render(scene, camera);
  }

  return {
    set(nextPlan, nextPalette, nextFrame) {
      plan = nextPlan;
      palette = nextPalette;
      frame = nextFrame;
      applyPalette(materials, nextPalette);
      ground.set(nextPalette.background);
      const { view, viewport, ratio } = nextFrame;
      const width = Math.max(1, Math.round(viewport.width * ratio));
      const height = Math.max(1, Math.round(viewport.height * ratio));
      if (width !== size.width || height !== size.height) {
        size = { width, height };
        renderer.setSize(width, height, false);
      }
      const frustum = frustumFor(viewport);
      camera.left = frustum.left;
      camera.right = frustum.right;
      camera.top = frustum.top;
      camera.bottom = frustum.bottom;
      const position = cameraPosition(view);
      camera.position.set(position.x, position.y, position.z);
      camera.lookAt(view.x, 0, view.z);
      camera.zoom = view.zoom;
      camera.updateProjectionMatrix();
      dropLabels();
      for (const room of nextPlan.rooms) {
        const label = makeLabel(three, room, nextPalette, ratio, room.label);
        placeLabel(label, view, viewport, ratio);
        labels.set(room.roomId, label);
      }
    },
    backdrop() {
      const now = current();
      empty();
      writeRooms(stage, now.plan.rooms, "far");
      // Without robots: every main desk, its screen dark. A side desk comes with its robot.
      writeDesks(stage, deskPlans({ ...now.plan, robots: [] }), now.palette);
      writeNotes(
        stage,
        now.plan.notes.filter((note) => !note.onDesk),
      );
      draw(true);
    },
    overlay() {
      const now = current();
      empty();
      writeRooms(stage, now.plan.rooms, "near");
      finishLayer(layers.floors, 0);
      finishLayer(layers.boards, 0);
      writeNotes(
        stage,
        now.plan.notes.filter((note) => note.onDesk),
      );
      for (const label of labels.values()) world.add(label.sprite);
      draw(false);
    },
    robot(robot, motion) {
      const now = current();
      empty();
      const desk = { x: robot.seat.x, z: robot.seat.z + DESK_OFFSET_Z, screenLit: robot.screenLit };
      writeDesks(stage, [desk], now.palette);
      // A main desk's shadow is in the backdrop already; twice, it would be twice as dark.
      if (!robot.side) finishLayer(layers.deskShadows, 0);
      const perUnit = pixelsPerUnit(now.frame.view, now.frame.viewport);
      writeRobotFrames(stage, rig, [{ robot, motion }], perUnit);
      draw(false);
    },
    plane(at, height) {
      current();
      empty();
      ensureCapacity(stage, layers.planes, 1);
      const placed = place(stage.dummy, { x: at.x, y: height, z: at.z, ry: PLANE_HEADING });
      layers.planes.mesh.setMatrixAt(0, placed.matrixWorld);
      finishLayer(layers.planes, 1);
      draw(false);
    },
    whole(robots) {
      const now = current();
      empty();
      writeRooms(stage, now.plan.rooms);
      const seated = robots.map(({ robot }) => robot);
      writeDesks(stage, deskPlans({ ...now.plan, robots: seated }), now.palette);
      writeNotes(stage, now.plan.notes);
      const perUnit = pixelsPerUnit(now.frame.view, now.frame.viewport);
      writeRobotFrames(stage, rig, robots, perUnit);
      for (const label of labels.values()) world.add(label.sprite);
      draw(true);
    },
    plates() {
      return new Map(
        [...labels].map(([roomId, label]) => [
          roomId,
          { width: label.width, height: label.height },
        ]),
      );
    },
    dispose() {
      dropLabels();
      for (const layer of Object.values(layers)) {
        layer.mesh.dispose();
        layer.geometry.dispose();
      }
      for (const material of Object.values(materials)) material.dispose();
      softTexture.dispose();
      renderer.forceContextLoss();
      renderer.dispose();
    },
  };
}
