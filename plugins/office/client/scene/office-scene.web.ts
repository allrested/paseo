// Web only: created by scene-view.tsx after three.js loaded. Nothing here runs at import time.
import { DOOR_WIDTH, ROOM_WIDTH, VIEW_TURN, WALL_HEIGHT, type Bounds } from "../layout.js";
import {
  CAMERA_EASE_MS,
  FIRST_MARGINS,
  RISE_SCALE,
  TAP_SLOP_PX,
  cameraPosition,
  easeView,
  firstView,
  focusOn,
  frustumFor,
  groundSpan,
  keptInside,
  keptOver,
  panBy,
  partView,
  pixelRatioFor,
  pixelsPerUnit,
  screenPoint,
  shiftOnScreen,
  wheelFactor,
  type CameraView,
  type GroundSpan,
  type ScreenPoint,
  type Viewport,
} from "./camera.js";
import {
  INITIAL_FOCUS,
  replan,
  requestFocus,
  resumeCamera,
  settle,
  takeCamera,
  type FocusGoal,
  type FocusState,
  type FocusTarget,
} from "./focus.js";
import type { ScenePalette } from "./palette.js";
import {
  PLATE_HEIGHT_PX,
  canvasPoint,
  distance,
  pinchView,
  targetAt,
  zoomAbout,
  type PickTarget,
  type PinchState,
  type RobotSpot,
  type WorldPoint,
} from "./picking.js";
import {
  TYPING_FRAME_MS,
  animationNeed,
  deskPlans,
  overflowTail,
  robotFrame,
  type AnimationNeed,
  type LampState,
  type RobotFrame,
  type RobotPlan,
  type RobotPose,
  type RoomPlan,
  type ScenePlan,
} from "./scene-plan.js";
import type {
  CameraLike,
  ColorLike,
  ColorMaterialLike,
  GeometryLike,
  InstancedMeshLike,
  MaterialLike,
  Object3DLike,
  SpriteLike,
  TextureLike,
  ThreeModule,
} from "./three-types.js";

/** The camera as the user left it, and the column count of the office it looked at. */
export interface KeptCamera {
  view: CameraView;
  columns: number;
}

export interface OfficeSceneOptions {
  three: ThreeModule;
  container: HTMLElement;
  coarsePointer: boolean;
  reducedMotion: boolean;
  /**
   * The camera an earlier scene was left with. The first plan with rooms starts from it when it
   * has the same column count; for another count the rooms stand elsewhere and it is dropped.
   */
  camera?: KeptCamera | null;
  onSelectAgent(agentId: string): void;
  onContextLost(): void;
}

export interface OfficeScene {
  update(plan: ScenePlan, palette: ScenePalette): void;
  focusRoom(roomId: string): void;
  focusAgent(agentId: string): void;
  /** The camera to keep for the next scene; null while it follows the office. */
  camera(): KeptCamera | null;
  dispose(): void;
}

const WHITE = "#ffffff";
const INITIAL_CAPACITY = 32;
const WALL_THICKNESS = 0.12;
/** A room is a tile this thick standing on the page; its top is the floor, at height 0. */
const SLAB_HEIGHT = 0.3;
/** The frame on top of each glass wall. */
const RAIL_HEIGHT = 0.05;
const DESK_SIZE = { width: 1, height: 0.7, depth: 0.6 };
/** A desk's screen lies in its top, like a light table: the camera looks down on it. */
const SCREEN_SIZE = { width: 0.66, height: 0.03, depth: 0.38 };
/**
 * The light of a lit screen, as two soft patches. The pool lies on the desk and reaches `back`
 * towards the robot. The other stands over the desk, `front` of its middle and clear of the
 * robot's head and hands, and lights the robot's front.
 */
const GLOW = {
  pool: { width: 2.1, depth: 1.8, back: 0.12 },
  face: { size: 1.4, y: 1, front: 0.08 },
};
const BOARD_SIZE = { width: 4, height: 1.6, depth: 0.06 };
const BOARD_CENTER_Y = 1.3;
/** The whiteboard's frame and legs. */
const BOARD_FRAME = 0.08;
/** Side of the soft shadow under a robot and under a desk, as (width, depth). */
const ROBOT_SHADOW = { width: 1.5, depth: 1.5 };
const DESK_SHADOW = { width: 1.9, depth: 1.5 };
/** Flat layers are stacked this far apart, so a 16-bit depth buffer still tells them apart. */
const FLAT_STEP = 0.03;
/**
 * A robot, from the floor up: a stand, the hip the body leans from, the neck the head turns on.
 * Heights from `neck` on are measured from the hip, and the head's parts from the neck.
 */
const ROBOT = {
  hip: 0.42,
  stand: { top: 0.11, bottom: 0.27 },
  body: { top: 0.26, bottom: 0.34, height: 0.7 },
  // The hands of a typing robot come down on its desk from here.
  shoulder: { x: 0.41, y: 0.58 },
  arm: { width: 0.12, length: 0.6 },
  neck: 0.74,
  head: { width: 0.68, height: 0.52, depth: 0.54 },
  visor: { width: 0.54, height: 0.24, depth: 0.04, y: 0.27 },
  eye: { width: 0.1, height: 0.13, depth: 0.03, apart: 0.14 },
  antenna: { width: 0.09, height: 0.2 },
};
/**
 * The lamp on the antenna, by state: a dot while the robot rests or works, a larger light when
 * it needs the owner. Radius in world units, and the radius it keeps on screen (CSS pixels)
 * however far the camera is: zoomed out, a lamp at its true size is a pixel or two.
 */
const LAMP_RADIUS: Record<LampState, number> = {
  off: 0.07,
  steady: 0.12,
  warning: 0.17,
  danger: 0.17,
};
const LAMP_MIN_PX: Record<LampState, number> = { off: 1.5, steady: 2.5, warning: 5, danger: 5 };
/** The danger lamp is a diamond: this much wider and taller than a round lamp of its radius. */
const DIAMOND = { wide: 1.15, tall: 1.6 };
/**
 * Eyes by pose, as the open eye's width and height scaled, and a turn: shut at rest, wide when
 * the robot asks for the owner, crossed after an error.
 */
const EYES: Record<RobotPose, { wide: number; tall: number; turn: number }> = {
  typing: { wide: 1, tall: 1, turn: 0 },
  walking: { wide: 1, tall: 1, turn: 0 },
  idle: { wide: 1.4, tall: 0.35, turn: 0 },
  raised: { wide: 1.2, tall: 1.25, turn: 0 },
  slumped: { wide: 1.4, tall: 0.35, turn: 0.6 },
};
/** Chest height of a robot: where a tap is measured from. */
const CHEST_Y = 1;
/** A room's name plate, in CSS pixels: it keeps its size on screen at every zoom. */
const LABEL = { height: PLATE_HEIGHT_PX, paddingX: 8, radius: 6, fontSize: 12, maxWidth: 152 };
// The app's UI font stack on web (DEFAULT_UI_FONT_STACK, packages/app/src/styles/theme.ts).
const LABEL_FONT_STACK =
  "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
/** How far a raised arm leans out, in radians. */
const ARM_SPLAY = 0.35;
/** A name plate's middle stands this far above the top of its room's back wall. */
const PLATE_RISE = 0.45;

interface Layer {
  mesh: InstancedMeshLike;
  capacity: number;
  readonly geometry: GeometryLike;
  readonly material: MaterialLike;
  /** Layers that blend are drawn in this order: shadows, then glass. */
  readonly order: number;
}

/** `tinted` is white and unlit: each instance carries its own colour (screens, visors, lamps). */
type MaterialName =
  | "roomFloor"
  | "wall"
  | "rail"
  | "desk"
  | "board"
  | "robotBody"
  | "robotHead"
  | "robotEye"
  | "tinted"
  | "glow"
  | "shadow";
type Materials = Record<MaterialName, ColorMaterialLike>;

type LayerName =
  | "floors"
  | "walls"
  | "rails"
  | "boards"
  | "desks"
  | "screens"
  | "stands"
  | "bodies"
  | "heads"
  | "visors"
  | "eyes"
  | "arms"
  | "antennas"
  | "lamps"
  | "dangers"
  | "deskShadows"
  | "shadows"
  | "glows";
type Layers = Record<LayerName, Layer>;

interface Rig {
  root: Object3DLike;
  hip: Object3DLike;
  body: Object3DLike;
  neck: Object3DLike;
  head: Object3DLike;
  visor: Object3DLike;
  eyeLeft: Object3DLike;
  eyeRight: Object3DLike;
  antenna: Object3DLike;
  lamp: Object3DLike;
  armLeft: Object3DLike;
  armRight: Object3DLike;
}

interface Label {
  sprite: SpriteLike;
  texture: TextureLike;
  /** Size on screen, CSS pixels. */
  width: number;
  height: number;
  /** The world point its left edge hangs from. */
  anchor: WorldPoint;
  drawn: string;
}

interface PlateSize {
  width: number;
  height: number;
}

/** How many lamps of each shape a frame has written so far. */
interface Lit {
  lamps: number;
  dangers: number;
}

/** A lamp as one frame draws it: its radius, and how far above the antenna's foot it sits. */
interface LampSize {
  radius: number;
  y: number;
}

interface Placement {
  x: number;
  y: number;
  z: number;
  /** Turned about the x axis: a quarter turn stands a flat patch up, facing the camera's side. */
  rx?: number;
  sx?: number;
  sy?: number;
  sz?: number;
}

interface Stage {
  three: ThreeModule;
  world: Object3DLike;
  layers: Layers;
  dummy: Object3DLike;
  tint: ColorLike;
}

const SOFT_STEPS = 16;

/** How strong a soft patch is from its middle (0) to its edge (1): full, then a smooth fall. */
function softness(t: number): number {
  const fall = Math.min(1, Math.max(0, (t - 0.1) / 0.9));
  return 1 - fall * fall * (3 - 2 * fall);
}

/**
 * A round patch that fades out to its edge. Stretched and coloured by its material, it is the
 * shadow under anything and the pool of light on a lit desk.
 */
function createSoftTexture(three: ThreeModule): TextureLike {
  const size = 64;
  const patch = document.createElement("canvas");
  patch.width = size;
  patch.height = size;
  const context = patch.getContext("2d");
  if (context !== null) {
    const fade = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    for (let step = 0; step <= SOFT_STEPS; step += 1) {
      const t = step / SOFT_STEPS;
      fade.addColorStop(t, `rgba(255, 255, 255, ${softness(t).toFixed(3)})`);
    }
    context.fillStyle = fade;
    context.fillRect(0, 0, size, size);
  }
  return new three.CanvasTexture(patch);
}

function createMaterials(three: ThreeModule, soft: TextureLike): Materials {
  const lit = () => new three.MeshLambertMaterial({ color: WHITE });
  const patch = (color: string) =>
    new three.MeshBasicMaterial({ color, map: soft, transparent: true, depthWrite: false });
  return {
    roomFloor: lit(),
    wall: new three.MeshLambertMaterial({ color: WHITE, transparent: true, depthWrite: false }),
    rail: lit(),
    desk: lit(),
    // Unlit, like a screen: a whiteboard is the brightest thing in its room.
    board: new three.MeshBasicMaterial({ color: WHITE }),
    // Each face of a body keeps one tone, like folded card.
    robotBody: new three.MeshLambertMaterial({ color: WHITE, flatShading: true }),
    robotHead: lit(),
    robotEye: new three.MeshBasicMaterial({ color: WHITE }),
    tinted: new three.MeshBasicMaterial({ color: WHITE }),
    glow: patch(WHITE),
    shadow: patch("#000000"),
  };
}

function applyPalette(materials: Materials, palette: ScenePalette): void {
  materials.roomFloor.color.set(palette.roomFloor);
  materials.wall.color.set(palette.wall);
  materials.wall.opacity = palette.wallOpacity;
  materials.rail.color.set(palette.wall);
  materials.desk.color.set(palette.desk);
  materials.board.color.set(palette.board);
  materials.robotBody.color.set(palette.robotBody);
  materials.robotHead.color.set(palette.robotHead);
  materials.robotEye.color.set(palette.robotEye);
  materials.glow.color.set(palette.glow);
  materials.glow.opacity = palette.glowOpacity;
  materials.shadow.opacity = palette.shadowOpacity;
}

function createMesh(three: ThreeModule, layer: Omit<Layer, "mesh">): InstancedMeshLike {
  const mesh = new three.InstancedMesh(layer.geometry, layer.material, layer.capacity);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.renderOrder = layer.order;
  return mesh;
}

function createLayer(
  three: ThreeModule,
  parent: Object3DLike,
  geometry: GeometryLike,
  material: MaterialLike,
  order = 0,
): Layer {
  const base = { capacity: INITIAL_CAPACITY, geometry, material, order };
  const mesh = createMesh(three, base);
  parent.add(mesh);
  return { ...base, mesh };
}

/** Grows a layer by replacing its mesh; geometry and material are shared and kept. */
function ensureCapacity(stage: Stage, layer: Layer, count: number): void {
  if (count <= layer.capacity) return;
  stage.world.remove(layer.mesh);
  layer.mesh.dispose();
  layer.capacity = Math.max(count, layer.capacity * 2);
  layer.mesh = createMesh(stage.three, layer);
  stage.world.add(layer.mesh);
}

function finishLayer(layer: Layer, count: number): void {
  layer.mesh.count = count;
  layer.mesh.instanceMatrix.needsUpdate = true;
  if (layer.mesh.instanceColor) layer.mesh.instanceColor.needsUpdate = true;
}

function place(dummy: Object3DLike, at: Placement): Object3DLike {
  dummy.position.set(at.x, at.y, at.z);
  dummy.rotation.set(at.rx ?? 0, 0, 0);
  dummy.scale.set(at.sx ?? 1, at.sy ?? 1, at.sz ?? 1);
  dummy.updateMatrixWorld(true);
  return dummy;
}

function createLayers(three: ThreeModule, parent: Object3DLike, materials: Materials): Layers {
  const flat = new three.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const unitBox = new three.BoxGeometry(1, 1, 1);
  const { stand, body, head, visor, eye, arm, antenna } = ROBOT;
  const layer = (geometry: GeometryLike, material: MaterialLike, order = 0) =>
    createLayer(three, parent, geometry, material, order);
  return {
    floors: layer(unitBox, materials.roomFloor),
    walls: layer(unitBox, materials.wall, 1),
    rails: layer(unitBox, materials.rail),
    boards: layer(
      new three.BoxGeometry(BOARD_SIZE.width, BOARD_SIZE.height, BOARD_SIZE.depth),
      materials.board,
    ),
    desks: layer(
      new three.BoxGeometry(DESK_SIZE.width, DESK_SIZE.height, DESK_SIZE.depth),
      materials.desk,
    ),
    screens: layer(
      new three.BoxGeometry(SCREEN_SIZE.width, SCREEN_SIZE.height, SCREEN_SIZE.depth),
      materials.tinted,
    ),
    // A unit tall and standing on the floor: each robot's is stretched up to its hip.
    stands: layer(
      new three.CylinderGeometry(stand.top, stand.bottom, 1, 8).translate(0, 0.5, 0),
      materials.robotHead,
    ),
    bodies: layer(
      new three.CylinderGeometry(body.top, body.bottom, body.height, 8),
      materials.robotBody,
    ),
    heads: layer(new three.BoxGeometry(head.width, head.height, head.depth), materials.robotHead),
    visors: layer(new three.BoxGeometry(visor.width, visor.height, visor.depth), materials.tinted),
    eyes: layer(new three.BoxGeometry(eye.width, eye.height, eye.depth), materials.robotEye),
    arms: layer(
      new three.BoxGeometry(arm.width, arm.length, arm.width).translate(0, -arm.length / 2, 0),
      materials.robotBody,
    ),
    antennas: layer(
      new three.BoxGeometry(antenna.width, antenna.height, antenna.width).translate(
        0,
        antenna.height / 2,
        0,
      ),
      materials.robotHead,
    ),
    // Three of the four lamps are round. The danger lamp is a diamond (eight faces, stretched),
    // so it differs from the warning lamp without its colour. It is turned to face the camera:
    // seen from any other side its outline is a lopsided square.
    lamps: layer(new three.SphereGeometry(1, 14, 10), materials.tinted),
    dangers: layer(
      new three.SphereGeometry(1, 4, 2)
        .rotateY(VIEW_TURN)
        .scale(DIAMOND.wide, DIAMOND.tall, DIAMOND.wide),
      materials.tinted,
    ),
    deskShadows: layer(flat, materials.shadow),
    shadows: layer(flat, materials.shadow),
    glows: layer(flat, materials.glow),
  };
}

function createRig(three: ThreeModule): Rig {
  const part = (x: number, y: number, z: number) => {
    const object = new three.Object3D();
    object.position.set(x, y, z);
    return object;
  };
  const { shoulder, eye } = ROBOT;
  const face = ROBOT.head.depth / 2;
  const root = part(0, 0, 0);
  const hip = part(0, ROBOT.hip, 0);
  const body = part(0, ROBOT.body.height / 2, 0);
  const neck = part(0, ROBOT.neck, 0);
  const head = part(0, ROBOT.head.height / 2, 0);
  const visor = part(0, ROBOT.visor.y, face + ROBOT.visor.depth / 4);
  const eyeLeft = part(-eye.apart, ROBOT.visor.y, face + ROBOT.visor.depth);
  const eyeRight = part(eye.apart, ROBOT.visor.y, face + ROBOT.visor.depth);
  // The antenna stands on top of the head and is turned back upright every frame, so the lamp
  // stays above the head when the robot leans: a slumped robot is seen under its lamp. The body
  // and the head turn about x and then about z; this order undoes exactly that.
  const antenna = part(0, ROBOT.head.height, 0);
  antenna.rotation.order = "ZYX";
  const lamp = part(0, ROBOT.antenna.height, 0);
  const armLeft = part(-shoulder.x, shoulder.y, 0);
  const armRight = part(shoulder.x, shoulder.y, 0);
  antenna.add(lamp);
  neck.add(head, visor, eyeLeft, eyeRight, antenna);
  hip.add(body, neck, armLeft, armRight);
  root.add(hip);
  return {
    root,
    hip,
    body,
    neck,
    head,
    visor,
    eyeLeft,
    eyeRight,
    antenna,
    lamp,
    armLeft,
    armRight,
  };
}

/** The five glass segments of a room: back, left, right, and the front on each side of the door. */
function wallSegments(room: RoomPlan, y: number, height: number): Placement[] {
  const { x, z } = room.center;
  const halfWidth = ROOM_WIDTH / 2;
  const halfDepth = room.depth / 2;
  const frontWidth = (ROOM_WIDTH - DOOR_WIDTH) / 2 + WALL_THICKNESS / 2;
  const frontOffset = halfWidth + WALL_THICKNESS / 2 - frontWidth / 2;
  const across = { y, sy: height, sz: WALL_THICKNESS };
  const along = { y, z, sx: WALL_THICKNESS, sy: height, sz: room.depth - WALL_THICKNESS };
  return [
    { ...across, x, z: z - halfDepth, sx: ROOM_WIDTH + WALL_THICKNESS },
    { ...along, x: x - halfWidth },
    { ...along, x: x + halfWidth },
    { ...across, x: x - frontOffset, z: z + halfDepth, sx: frontWidth },
    { ...across, x: x + frontOffset, z: z + halfDepth, sx: frontWidth },
  ];
}

/** The whiteboard's two legs, then the bars above and below its face. */
function boardFrame(room: RoomPlan): Placement[] {
  const { x, z } = room.board;
  const side = BOARD_SIZE.width / 2 + BOARD_FRAME / 2;
  const top = BOARD_CENTER_Y + BOARD_SIZE.height / 2 + BOARD_FRAME;
  const bottom = BOARD_CENTER_Y - BOARD_SIZE.height / 2;
  const leg = { y: top / 2, z, sx: BOARD_FRAME, sy: top, sz: BOARD_FRAME };
  const bar = { x, z, sx: BOARD_SIZE.width, sy: BOARD_FRAME, sz: BOARD_FRAME };
  return [
    { ...leg, x: x - side },
    { ...leg, x: x + side },
    { ...bar, y: top - BOARD_FRAME / 2 },
    { ...bar, y: bottom - BOARD_FRAME / 2 },
  ];
}

function writeAll(stage: Stage, layer: Layer, at: readonly Placement[]): void {
  ensureCapacity(stage, layer, at.length);
  at.forEach((placement, index) => {
    layer.mesh.setMatrixAt(index, place(stage.dummy, placement).matrixWorld);
  });
  finishLayer(layer, at.length);
}

function writeRooms(stage: Stage, rooms: readonly RoomPlan[]): void {
  const { floors, walls, rails, boards } = stage.layers;
  const rim = WALL_THICKNESS;
  writeAll(
    stage,
    floors,
    rooms.map((room) => ({
      x: room.center.x,
      y: -SLAB_HEIGHT / 2,
      z: room.center.z,
      sx: ROOM_WIDTH + rim,
      sy: SLAB_HEIGHT,
      sz: room.depth + rim,
    })),
  );
  writeAll(
    stage,
    boards,
    rooms.map((room) => ({ x: room.board.x, y: BOARD_CENTER_Y, z: room.board.z })),
  );
  writeAll(
    stage,
    walls,
    rooms.flatMap((room) => wallSegments(room, WALL_HEIGHT / 2, WALL_HEIGHT)),
  );
  const frames = rooms.flatMap((room) => [
    ...wallSegments(room, WALL_HEIGHT + RAIL_HEIGHT / 2, RAIL_HEIGHT),
    ...boardFrame(room),
  ]);
  writeAll(stage, rails, frames);
}

function writeDesks(stage: Stage, plan: ScenePlan, colors: ScenePalette): void {
  const { desks, screens, deskShadows, glows } = stage.layers;
  const all = deskPlans(plan);
  const top = DESK_SIZE.height + SCREEN_SIZE.height;
  writeAll(
    stage,
    desks,
    all.map((desk) => ({ x: desk.x, y: DESK_SIZE.height / 2, z: desk.z })),
  );
  writeAll(
    stage,
    deskShadows,
    all.map((desk) => ({
      x: desk.x,
      y: FLAT_STEP,
      z: desk.z,
      sx: DESK_SHADOW.width,
      sz: DESK_SHADOW.depth,
    })),
  );
  ensureCapacity(stage, screens, all.length);
  all.forEach((desk, index) => {
    const screen = { x: desk.x, y: top - SCREEN_SIZE.height / 2, z: desk.z };
    screens.mesh.setMatrixAt(index, place(stage.dummy, screen).matrixWorld);
    const color = desk.screenLit ? colors.monitorLit : colors.monitorDim;
    screens.mesh.setColorAt(index, stage.tint.set(color));
  });
  finishLayer(screens, all.length);
  writeAll(
    stage,
    glows,
    all
      .filter((desk) => desk.screenLit)
      .flatMap((desk) => [
        {
          x: desk.x,
          y: top + FLAT_STEP,
          z: desk.z - GLOW.pool.back,
          sx: GLOW.pool.width,
          sz: GLOW.pool.depth,
        },
        {
          x: desk.x,
          y: GLOW.face.y,
          z: desk.z + GLOW.face.front,
          rx: Math.PI / 2,
          sx: GLOW.face.size,
          sz: GLOW.face.size,
        },
      ]),
  );
}

/** `head` then `tail` in `width`: a long head is cut, the tail (a count) never is. */
function fitted(
  context: CanvasRenderingContext2D,
  head: string,
  tail: string,
  width: number,
): string {
  if (context.measureText(`${head}${tail}`).width <= width) return `${head}${tail}`;
  let cut = head;
  while (cut.length > 1 && context.measureText(`${cut}…${tail}`).width > width) {
    cut = cut.slice(0, -1);
  }
  return `${cut}…${tail}`;
}

/**
 * Draws a name plate at `ratio` device pixels per CSS pixel and returns its size in CSS pixels.
 * The canvas is a whole number of device pixels, so the size may be a fraction of a CSS pixel.
 */
function drawLabel(
  canvas: HTMLCanvasElement,
  room: RoomPlan,
  palette: ScenePalette,
  ratio: number,
): PlateSize {
  const context = canvas.getContext("2d");
  if (context === null) return { width: 0, height: 0 };
  const font = `500 ${LABEL.fontSize}px ${LABEL_FONT_STACK}`;
  context.font = font;
  const tail = overflowTail(room.overflow);
  const name = room.label.slice(0, room.label.length - tail.length);
  const shown = fitted(context, name, tail, LABEL.maxWidth - LABEL.paddingX * 2);
  const textWidth = Math.ceil(context.measureText(shown).width);
  canvas.width = Math.ceil((textWidth + LABEL.paddingX * 2) * ratio);
  canvas.height = Math.ceil(LABEL.height * ratio);
  const size = { width: canvas.width / ratio, height: canvas.height / ratio };
  context.scale(ratio, ratio);
  context.fillStyle = palette.label;
  context.beginPath();
  // Safari before 16 has no roundRect; a plate with square corners is better than none.
  if (typeof context.roundRect === "function") {
    context.roundRect(0, 0, size.width, size.height, LABEL.radius);
  } else {
    context.rect(0, 0, size.width, size.height);
  }
  context.fill();
  context.fillStyle = palette.labelText;
  // Resizing a canvas resets its context, the font included.
  context.font = font;
  context.textBaseline = "middle";
  context.fillText(shown, LABEL.paddingX, size.height / 2 + 0.5);
  return size;
}

/**
 * Where a room's name plate hangs: over the back left corner, the first point of the room on
 * screen. The plates of a column start on one line, each above the room it names.
 */
function labelAnchor(room: RoomPlan): WorldPoint {
  return {
    x: room.center.x - ROOM_WIDTH / 2,
    y: WALL_HEIGHT + PLATE_RISE,
    z: room.center.z - room.depth / 2,
  };
}

/** The ground a room's slab covers. */
function roomFootprint(room: RoomPlan): Bounds {
  const halfWidth = (ROOM_WIDTH + WALL_THICKNESS) / 2;
  const halfDepth = (room.depth + WALL_THICKNESS) / 2;
  return {
    minX: room.center.x - halfWidth,
    maxX: room.center.x + halfWidth,
    minZ: room.center.z - halfDepth,
    maxZ: room.center.z + halfDepth,
  };
}

/**
 * Each lamp as a frame draws it. A lamp grows to stay findable from far away. A round one then
 * rises, so that its lower edge stays where it was on screen, on the antenna. The diamond stands
 * on its lower point.
 */
function lampSizes(perUnit: number): Record<LampState, LampSize> {
  const sized = (lamp: LampState): LampSize => {
    const base = LAMP_RADIUS[lamp];
    const radius = base * Math.max(1, LAMP_MIN_PX[lamp] / (base * perUnit));
    const y = lamp === "danger" ? radius * DIAMOND.tall : base + (radius - base) * RISE_SCALE;
    return { radius, y: ROBOT.antenna.height + y };
  };
  return {
    off: sized("off"),
    steady: sized("steady"),
    warning: sized("warning"),
    danger: sized("danger"),
  };
}

/** An arm above the shoulder leans away from the head, so a raised hand shows beside it. */
function armSplay(angle: number): number {
  return Math.max(0, -Math.cos(angle)) * ARM_SPLAY;
}

/**
 * True when the rooms were dealt again for another column count: the old view then shows the
 * wrong place. A room that grew by a row, or one that left, only moves the rooms behind it, and
 * the user's pan and zoom are kept.
 */
function dealtAgain(before: ScenePlan, after: ScenePlan): boolean {
  return before.rooms.length > 0 && after.rooms.length > 0 && before.columns !== after.columns;
}

export function createOfficeScene(options: OfficeSceneOptions): OfficeScene {
  const { three, container } = options;
  const canvas = document.createElement("canvas");
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  canvas.style.touchAction = "none";
  canvas.style.cursor = "grab";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Office in 3D");

  const renderer = new three.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "low-power",
  });
  container.appendChild(canvas);
  renderer.outputColorSpace = three.SRGBColorSpace;
  const scene = new three.Scene();
  const background: ColorLike = new three.Color(WHITE);
  scene.background = background;
  // A negative near plane is legal for an orthographic camera; with a small positive one the
  // front rows of a large office fall behind it.
  const camera: CameraLike = new three.OrthographicCamera(-1, 1, 1, -1, -200, 400);
  // Surfaces that face up come out at their palette colour, the ones facing the camera darker.
  const hemisphere = new three.HemisphereLight(WHITE, "#808080", 2.2);
  const sun = new three.DirectionalLight(WHITE, 1.2);
  sun.position.set(8, 20, 12);
  scene.add(hemisphere, sun);

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

  let plan: ScenePlan = {
    rooms: [],
    robots: [],
    bounds: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 },
    columns: 0,
  };
  /** The ground the rooms cover, as the camera sees it: what is framed and panned over. */
  let span: GroundSpan = groundSpan([]);
  let colors: ScenePalette | null = null;
  const enteredAt = new Map<string, number>();
  /** When each robot took its present pose: a robot that starts to wait waves from then. */
  const posedAt = new Map<string, number>();
  let viewport: Viewport = { width: 0, height: 0 };
  let ratio = 1;
  let view: CameraView = { x: 0, z: 0, zoom: 1 };
  let easing: { from: CameraView; to: CameraView; start: number } | null = null;
  let focus: FocusState = INITIAL_FOCUS;
  /** The camera of an earlier scene, until the first plan with rooms takes it or drops it. */
  let kept: KeptCamera | null = options.camera ?? null;
  let onScreen = true;
  let visible = document.visibilityState === "visible";
  /** Set by dispose and by a lost context: after either, nothing is drawn again. */
  let stopped = false;
  let contextLost = false;
  let frameRequest: number | null = null;
  let typingTimer: ReturnType<typeof setTimeout> | null = null;

  function cancelFrames(): void {
    if (frameRequest !== null) cancelAnimationFrame(frameRequest);
    frameRequest = null;
    if (typingTimer !== null) clearTimeout(typingTimer);
    typingTimer = null;
  }

  function invalidate(): void {
    if (stopped || !visible || viewport.width === 0 || frameRequest !== null) return;
    frameRequest = requestAnimationFrame(frame);
  }

  function setView(next: CameraView): void {
    easing = null;
    view = next;
    invalidate();
  }

  function moveTo(next: CameraView): void {
    if (options.reducedMotion) {
      setView(next);
      return;
    }
    easing = { from: view, to: next, start: performance.now() };
    invalidate();
  }

  function applyCamera(now: number): boolean {
    if (easing !== null) {
      const progress = (now - easing.start) / CAMERA_EASE_MS;
      view = easeView(easing.from, easing.to, progress);
      if (progress >= 1) easing = null;
    }
    const position = cameraPosition(view);
    camera.position.set(position.x, position.y, position.z);
    camera.lookAt(view.x, 0, view.z);
    camera.zoom = view.zoom;
    camera.updateProjectionMatrix();
    return easing !== null;
  }

  function disposeLabel(label: Label): void {
    world.remove(label.sprite);
    label.sprite.material.dispose();
    label.texture.dispose();
  }

  /** A plate is drawn at the size it has on screen, so its text stays sharp. */
  function drawnLabel(room: RoomPlan, palette: ScenePalette): Label {
    const key = `${room.label}|${palette.label}|${palette.labelText}|${ratio}`;
    const current = labels.get(room.roomId);
    if (current && current.drawn === key) return current;
    if (current) disposeLabel(current);
    const plate = document.createElement("canvas");
    const size = drawLabel(plate, room, palette, ratio);
    const texture = new three.CanvasTexture(plate);
    texture.colorSpace = three.SRGBColorSpace;
    const material = new three.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    const sprite = new three.Sprite(material);
    sprite.center.set(0, 0.5);
    sprite.renderOrder = 2;
    world.add(sprite);
    const label = { sprite, texture, ...size, anchor: labelAnchor(room), drawn: key };
    labels.set(room.roomId, label);
    return label;
  }

  function writeLabels(palette: ScenePalette): void {
    const seen = new Set<string>();
    for (const room of plan.rooms) {
      seen.add(room.roomId);
      drawnLabel(room, palette).anchor = labelAnchor(room);
    }
    for (const [roomId, label] of labels) {
      if (seen.has(roomId)) continue;
      disposeLabel(label);
      labels.delete(roomId);
    }
  }

  /**
   * Plates keep their size in CSS pixels at every zoom, and are moved by a fraction of a pixel
   * onto whole device pixels: each texel then covers one pixel and the text stays sharp.
   */
  function placeLabels(): void {
    const perUnit = pixelsPerUnit(view, viewport);
    for (const label of labels.values()) {
      const { anchor } = label;
      const at = screenPoint(view, viewport, anchor);
      const top = at.y - label.height / 2;
      const dx = Math.round(at.x * ratio) / ratio - at.x;
      const dy = Math.round(top * ratio) / ratio - top;
      const snapped = shiftOnScreen(view, viewport, anchor, dx, dy);
      label.sprite.position.set(snapped.x, snapped.y, snapped.z);
      label.sprite.scale.set(label.width / perUnit, label.height / perUnit, 1);
    }
  }

  /** Puts the one rig in a robot's pose; its parts' matrices are then read off into the layers. */
  function poseRig(robot: RobotPlan, motion: RobotFrame, lamp: LampSize): void {
    const eyes = EYES[robot.pose];
    rig.root.position.set(motion.x, motion.lift, motion.z);
    rig.root.rotation.set(0, motion.heading, 0);
    rig.hip.rotation.set(motion.lean, 0, 0);
    rig.neck.rotation.set(motion.nod, 0, motion.tilt);
    rig.antenna.rotation.set(-motion.lean - motion.nod, 0, -motion.tilt);
    rig.lamp.position.set(0, lamp.y, 0);
    // The antenna is upright; this leaves the lamp facing the camera whichever way the robot walks.
    rig.lamp.rotation.set(0, -motion.heading, 0);
    rig.lamp.scale.set(lamp.radius, lamp.radius, lamp.radius);
    rig.eyeLeft.scale.set(eyes.wide, eyes.tall, 1);
    rig.eyeLeft.rotation.set(0, 0, eyes.turn);
    rig.eyeRight.scale.set(eyes.wide, eyes.tall, 1);
    rig.eyeRight.rotation.set(0, 0, -eyes.turn);
    rig.armLeft.rotation.set(motion.armLeft, 0, -armSplay(motion.armLeft));
    rig.armRight.rotation.set(motion.armRight, 0, armSplay(motion.armRight) + motion.armSway);
    rig.root.updateMatrixWorld(true);
  }

  function writeRobot(
    robot: RobotPlan,
    index: number,
    now: number,
    sizes: Record<LampState, LampSize>,
    lit: Lit,
  ): void {
    const { stands, bodies, heads, visors, eyes, arms, antennas, lamps, dangers, shadows } = layers;
    const entered = enteredAt.get(robot.agentId) ?? now;
    const posed = posedAt.get(robot.agentId) ?? now;
    const motion = robotFrame(robot, entered, now, options.reducedMotion, posed);
    poseRig(robot, motion, sizes[robot.lamp]);
    bodies.mesh.setMatrixAt(index, rig.body.matrixWorld);
    heads.mesh.setMatrixAt(index, rig.head.matrixWorld);
    visors.mesh.setMatrixAt(index, rig.visor.matrixWorld);
    visors.mesh.setColorAt(index, stage.tint.set(robot.visor));
    antennas.mesh.setMatrixAt(index, rig.antenna.matrixWorld);
    eyes.mesh.setMatrixAt(index * 2, rig.eyeLeft.matrixWorld);
    eyes.mesh.setMatrixAt(index * 2 + 1, rig.eyeRight.matrixWorld);
    arms.mesh.setMatrixAt(index * 2, rig.armLeft.matrixWorld);
    arms.mesh.setMatrixAt(index * 2 + 1, rig.armRight.matrixWorld);
    // The stand stays on the floor and reaches up to the hip: a robot that stands up rises on it.
    const stand = { x: motion.x, y: 0, z: motion.z, sy: ROBOT.hip + motion.lift };
    stands.mesh.setMatrixAt(index, place(stage.dummy, stand).matrixWorld);
    const shadow = {
      x: motion.x,
      y: FLAT_STEP * 2,
      z: motion.z,
      sx: ROBOT_SHADOW.width,
      sz: ROBOT_SHADOW.depth,
    };
    shadows.mesh.setMatrixAt(index, place(stage.dummy, shadow).matrixWorld);
    const danger = robot.lamp === "danger";
    const layer = danger ? dangers : lamps;
    const slot = danger ? lit.dangers : lit.lamps;
    layer.mesh.setMatrixAt(slot, rig.lamp.matrixWorld);
    layer.mesh.setColorAt(slot, stage.tint.set(robot.lampColor));
    if (danger) lit.dangers += 1;
    else lit.lamps += 1;
  }

  function writeRobots(now: number): void {
    const { stands, bodies, heads, visors, eyes, arms, antennas, lamps, dangers, shadows } = layers;
    const count = plan.robots.length;
    for (const layer of [stands, bodies, heads, visors, antennas, lamps, dangers, shadows]) {
      ensureCapacity(stage, layer, count);
    }
    for (const layer of [eyes, arms]) ensureCapacity(stage, layer, count * 2);
    const sizes = lampSizes(pixelsPerUnit(view, viewport));
    const lit: Lit = { lamps: 0, dangers: 0 };
    plan.robots.forEach((robot, index) => writeRobot(robot, index, now, sizes, lit));
    for (const layer of [stands, bodies, heads, visors, antennas, shadows]) {
      finishLayer(layer, count);
    }
    for (const layer of [eyes, arms]) finishLayer(layer, count * 2);
    finishLayer(lamps, lit.lamps);
    finishLayer(dangers, lit.dangers);
  }

  function draw(now: number): { easing: boolean; need: AnimationNeed } {
    const moving = applyCamera(now);
    placeLabels();
    writeRobots(now);
    renderer.render(scene, camera);
    const need = animationNeed(plan.robots, enteredAt, now, options.reducedMotion, posedAt);
    return { easing: moving, need };
  }

  function frame(now: number): void {
    frameRequest = null;
    if (stopped || !visible) return;
    try {
      const result = draw(now);
      if (result.easing || result.need === "smooth") {
        invalidate();
      } else if (result.need === "typing" && typingTimer === null) {
        typingTimer = setTimeout(() => {
          typingTimer = null;
          invalidate();
        }, TYPING_FRAME_MS);
      }
    } catch (error) {
      console.error("[office] scene frame failed", error);
    }
  }

  /** The camera on one room: the room whole and as wide as the screen takes it. */
  function roomView(room: RoomPlan): CameraView {
    return partView(groundSpan([roomFootprint(room)]), span, viewport, FIRST_MARGINS);
  }

  function isShown(target: FocusTarget): boolean {
    if ("roomId" in target) return plan.rooms.some((room) => room.roomId === target.roomId);
    return plan.robots.some((robot) => robot.agentId === target.agentId);
  }

  /** The view a goal asks for, or null when its room or robot is not in the plan. */
  function goalView(goal: FocusGoal): CameraView | null {
    if (goal === "office") return firstView(span, viewport, FIRST_MARGINS);
    if ("roomId" in goal) {
      const room = plan.rooms.find((candidate) => candidate.roomId === goal.roomId);
      return room ? roomView(room) : null;
    }
    const robot = plan.robots.find((candidate) => candidate.agentId === goal.agentId);
    if (!robot) return null;
    return keptInside(focusOn(view, robot.seat, viewport), span, viewport, FIRST_MARGINS);
  }

  /**
   * Puts the office in frame (`firstView`): once when it never was, and again for as long as
   * nobody has moved the camera (on resize and when rooms come, go or grow). A focus asked for
   * before its room or robot could be shown is shown instead, once. The first framing jumps.
   */
  function frameOffice(ease: boolean): void {
    const wasFramed = focus.framed;
    const ready = viewport.width !== 0 && plan.rooms.length > 0;
    const step = settle(focus, ready, isShown);
    focus = step.state;
    const next = step.goal === null ? null : goalView(step.goal);
    if (next === null) return;
    const target = easing?.to ?? view;
    const same = next.x === target.x && next.z === target.z && next.zoom === target.zoom;
    if (wasFramed && same) return;
    if (ease && wasFramed) moveTo(next);
    else setView(next);
  }

  /**
   * The first plan with rooms starts from the camera an earlier scene was left with. For another
   * column count the rooms stand elsewhere, so the office is framed as on any first plan.
   */
  function takeKeptCamera(columns: number): void {
    if (kept === null) return;
    if (kept.columns === columns) {
      view = kept.view;
      focus = resumeCamera(focus);
    }
    kept = null;
  }

  /**
   * The camera stays the user's when rooms leave, but not over ground the office gave up: left
   * there, the next drag would snap it back by the whole distance.
   */
  function stayOverOffice(): void {
    if (!focus.framed || focus.following || plan.rooms.length === 0) return;
    const target = easing?.to ?? view;
    const over = keptOver(target, span);
    if (over !== target) moveTo(over);
  }

  /** A focus from the host or a plate tap: eased to at once, or kept until it can be shown. */
  function focusOnTarget(target: FocusTarget): void {
    const step = requestFocus(focus, target, isShown(target));
    focus = step.state;
    const next = step.goal === null ? null : goalView(step.goal);
    if (next !== null) moveTo(next);
  }

  function resizeToContainer(): void {
    const width = container.clientWidth;
    const height = container.clientHeight;
    // A hidden tab is display: none, so 0 x 0: keep the last size and draw nothing.
    if (width === 0 || height === 0) return;
    viewport = { width, height };
    const nextRatio = pixelRatioFor(window.devicePixelRatio || 1, options.coarsePointer);
    renderer.setPixelRatio(nextRatio);
    renderer.setSize(width, height, false);
    const frustum = frustumFor(viewport);
    camera.left = frustum.left;
    camera.right = frustum.right;
    camera.top = frustum.top;
    camera.bottom = frustum.bottom;
    if (nextRatio !== ratio) {
      ratio = nextRatio;
      if (colors) writeLabels(colors);
    }
    frameOffice(false);
    invalidate();
  }

  function refreshVisible(): void {
    const next = onScreen && document.visibilityState === "visible";
    if (next === visible) return;
    visible = next;
    if (visible) invalidate();
    else cancelFrames();
  }

  /** Every robot's chest where it is drawn now: the points a tap is measured from. */
  function robotSpots(now: number): RobotSpot[] {
    return plan.robots.map((robot) => {
      const entered = enteredAt.get(robot.agentId) ?? now;
      const motion = robotFrame(robot, entered, now, options.reducedMotion);
      const chest = { x: motion.x, y: motion.lift + CHEST_Y, z: motion.z };
      return { agentId: robot.agentId, chest };
    });
  }

  function pickAt(at: ScreenPoint): PickTarget | null {
    return targetAt({ view, viewport }, labels, robotSpots(performance.now()), at);
  }

  function pointerAt(event: { clientX: number; clientY: number }): ScreenPoint {
    return canvasPoint(event, canvas.getBoundingClientRect(), viewport);
  }

  const pointers = new Map<number, ScreenPoint>();
  let gesture: { start: ScreenPoint; moved: boolean; multi: boolean } | null = null;
  let pinch: PinchState | null = null;

  function pinchState(): PinchState | null {
    const [first, second] = [...pointers.values()];
    if (!first || !second || pointers.size !== 2) return null;
    return {
      spread: distance(first, second),
      middle: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
    };
  }

  /** The user dragged, pinched or turned the wheel: the camera stops following the office. */
  function steer(next: CameraView): void {
    focus = takeCamera(focus);
    setView(next);
  }

  function onPointerDown(event: PointerEvent): void {
    // Only the main mouse button pans and picks; touch and pen always report button 0.
    if (event.button !== 0) return;
    canvas.setPointerCapture(event.pointerId);
    const at = pointerAt(event);
    pointers.set(event.pointerId, at);
    if (pointers.size === 1) {
      gesture = { start: at, moved: false, multi: false };
    } else if (gesture) {
      gesture.multi = true;
    }
    pinch = pinchState();
  }

  function onPointerMove(event: PointerEvent): void {
    const at = pointerAt(event);
    const last = pointers.get(event.pointerId);
    if (!last) {
      canvas.style.cursor = pickAt(at) === null ? "grab" : "pointer";
      return;
    }
    pointers.set(event.pointerId, at);
    if (gesture && distance(at, gesture.start) > TAP_SLOP_PX) gesture.moved = true;
    if (pointers.size === 1 && gesture?.moved) {
      canvas.style.cursor = "grabbing";
      steer(panBy(view, at.x - last.x, at.y - last.y, viewport, span));
      return;
    }
    const next = pinchState();
    if (next !== null && pinch !== null && pinch.spread > 0) {
      steer(pinchView(view, pinch, next, viewport, span));
    }
    pinch = next;
  }

  function pick(at: ScreenPoint): void {
    const target = pickAt(at);
    if (target === null) return;
    if ("agentId" in target) options.onSelectAgent(target.agentId);
    else focusOnTarget(target);
  }

  function onPointerUp(event: PointerEvent): void {
    pointers.delete(event.pointerId);
    if (gesture && pointers.size === 0) {
      const tap = !gesture.moved && !gesture.multi && event.type === "pointerup";
      gesture = null;
      canvas.style.cursor = "grab";
      if (tap) pick(pointerAt(event));
    }
    pinch = pinchState();
  }

  function onWheel(event: WheelEvent): void {
    event.preventDefault();
    steer(zoomAbout(view, wheelFactor(event.deltaY), pointerAt(event), viewport, span));
  }

  function onContextLost(event: Event): void {
    event.preventDefault();
    stopped = true;
    contextLost = true;
    cancelFrames();
    options.onContextLost();
  }

  function onVisibility(): void {
    refreshVisible();
  }

  const resizeObserver = new ResizeObserver(() => resizeToContainer());
  resizeObserver.observe(container);
  const intersectionObserver = new IntersectionObserver((entries) => {
    // Records come in order: when the container was shown and hidden again, the last one counts.
    const latest = entries[entries.length - 1];
    if (latest) onScreen = latest.isIntersecting;
    refreshVisible();
  });
  intersectionObserver.observe(container);
  document.addEventListener("visibilitychange", onVisibility);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("webglcontextlost", onContextLost);
  resizeToContainer();

  return {
    update(nextPlan, nextPalette) {
      if (stopped) return;
      const now = performance.now();
      const poses = new Map(plan.robots.map((robot) => [robot.agentId, robot.pose]));
      for (const robot of nextPlan.robots) {
        if (!enteredAt.has(robot.agentId)) enteredAt.set(robot.agentId, now);
        if (poses.get(robot.agentId) !== robot.pose) posedAt.set(robot.agentId, now);
      }
      const present = new Set(nextPlan.robots.map((robot) => robot.agentId));
      for (const agentId of enteredAt.keys()) {
        if (present.has(agentId)) continue;
        enteredAt.delete(agentId);
        posedAt.delete(agentId);
      }
      // After a new deal (a phone turned on its side) the old view shows the wrong place, and an
      // office that emptied is framed again when its rooms come back. Both jump, without easing.
      if (nextPlan.rooms.length > 0) takeKeptCamera(nextPlan.columns);
      focus = replan(focus, dealtAgain(plan, nextPlan) || nextPlan.rooms.length === 0);
      plan = nextPlan;
      span = groundSpan(nextPlan.rooms.map(roomFootprint));
      colors = nextPalette;
      applyPalette(materials, nextPalette);
      background.set(nextPalette.background);
      writeRooms(stage, nextPlan.rooms);
      writeDesks(stage, nextPlan, nextPalette);
      writeLabels(nextPalette);
      frameOffice(true);
      stayOverOffice();
      invalidate();
    },
    focusRoom(roomId) {
      focusOnTarget({ roomId });
    },
    focusAgent(agentId) {
      focusOnTarget({ agentId });
    },
    camera() {
      if (kept !== null) return kept;
      if (!focus.framed || focus.following || plan.rooms.length === 0) return null;
      return { view: easing?.to ?? view, columns: plan.columns };
    },
    dispose() {
      stopped = true;
      cancelFrames();
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      for (const label of labels.values()) disposeLabel(label);
      labels.clear();
      for (const layer of Object.values(layers)) {
        layer.mesh.dispose();
        layer.geometry.dispose();
      }
      for (const material of Object.values(materials)) material.dispose();
      softTexture.dispose();
      // The listener is gone, so this does not report a lost context; it frees the context now
      // instead of when the canvas is collected (browsers cap live contexts). A context that is
      // already lost has nothing to free, and three.js warns when asked.
      if (!contextLost) renderer.forceContextLoss();
      renderer.dispose();
      canvas.remove();
    },
  };
}
