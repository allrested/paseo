// Web only: created by scene-view.tsx after three.js loaded. Nothing here runs at import time.
import { DOOR_WIDTH, ROOM_DEPTH, ROOM_WIDTH, WALL_HEIGHT, type Bounds } from "../layout.js";
import {
  CAMERA_BACK,
  CAMERA_EASE_MS,
  CAMERA_HEIGHT,
  TAP_SLOP_PX,
  cameraPosition,
  easeView,
  focusOn,
  frameBounds,
  frustumFor,
  panBy,
  pixelRatioFor,
  pixelsPerUnit,
  screenPoint,
  wheelFactor,
  zoomBy,
  type CameraView,
  type ScreenPoint,
  type Viewport,
} from "./camera.js";
import type { ScenePalette } from "./palette.js";
import {
  TYPING_FRAME_MS,
  animationNeed,
  deskPlans,
  robotFrame,
  type AnimationNeed,
  type RobotPlan,
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

export interface OfficeSceneOptions {
  three: ThreeModule;
  container: HTMLElement;
  coarsePointer: boolean;
  reducedMotion: boolean;
  onSelectAgent(agentId: string): void;
  onContextLost(): void;
}

export interface OfficeScene {
  update(plan: ScenePlan, palette: ScenePalette): void;
  focusRoom(roomId: string): void;
  focusAgent(agentId: string): void;
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
const MONITOR_SIZE = { width: 0.56, height: 0.4, depth: 0.05 };
const BOARD_SIZE = { width: 4, height: 1.6, depth: 0.06 };
const BOARD_CENTER_Y = 1.3;
/** The whiteboard's frame and legs. */
const BOARD_FRAME = 0.08;
/** Side of the soft shadow under a robot and under a desk, as (width, depth). */
const ROBOT_SHADOW = { width: 1.5, depth: 1.5 };
const DESK_SHADOW = { width: 1.9, depth: 1.5 };
/** Flat layers are stacked this far apart, so a 16-bit depth buffer still tells them apart. */
const FLAT_STEP = 0.03;
const LIGHT_RADIUS = 0.2;
/** Height of the light above the floor: clear of the head, seen from the camera. */
const LIGHT_Y = 2.3;
/** The light never gets smaller than this on screen (radius, CSS pixels). */
const LIGHT_MIN_PX = 5;
/** World height that covers one world unit of screen height, the camera looking down. */
const RISE_PER_SCREEN_UNIT = Math.hypot(CAMERA_HEIGHT, CAMERA_BACK) / CAMERA_BACK;
/** Chest height of a robot: where a tap is measured from. */
const CHEST_Y = 1;
/** Half of the app's 44 px touch target (packages/app/src/components/ui/control-geometry.ts). */
const TAP_RADIUS_PX = 22;
/** A room's name plate, in CSS pixels: it keeps its size on screen at every zoom. */
const LABEL = { height: 20, paddingX: 7, radius: 6, fontSize: 12, maxWidth: 120 };
// The app's UI font stack on web (DEFAULT_UI_FONT_STACK, packages/app/src/styles/theme.ts).
const LABEL_FONT_STACK =
  "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
/** How far a raised arm leans out, in radians. */
const ARM_SPLAY = 0.35;
/** The first framing leaves this much less at each side than the layout's own margin. */
const FRAME_INSET = 1;
/** Room to spare around a room when the camera frames it. */
const ROOM_FRAME = { side: 0.6, back: 2, front: 1 };

interface Layer {
  mesh: InstancedMeshLike;
  capacity: number;
  readonly geometry: GeometryLike;
  readonly material: MaterialLike;
  /** Layers that blend are drawn in this order: shadows, then glass. */
  readonly order: number;
}

/** `tinted` is white and unlit: each instance carries its own colour (screens, visors, lights). */
type MaterialName =
  | "roomFloor"
  | "wall"
  | "rail"
  | "desk"
  | "board"
  | "robotBody"
  | "robotHead"
  | "tinted"
  | "shadow";
type Materials = Record<MaterialName, ColorMaterialLike>;

type LayerName =
  | "floors"
  | "walls"
  | "rails"
  | "boards"
  | "desks"
  | "monitors"
  | "bodies"
  | "heads"
  | "visors"
  | "arms"
  | "warnings"
  | "dangers"
  | "deskShadows"
  | "shadows";
type Layers = Record<LayerName, Layer>;

interface Rig {
  root: Object3DLike;
  hip: Object3DLike;
  body: Object3DLike;
  head: Object3DLike;
  visor: Object3DLike;
  light: Object3DLike;
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

interface WorldPoint {
  x: number;
  y: number;
  z: number;
}

interface PlateSize {
  width: number;
  height: number;
}

/** How many lights of each kind a frame has written so far. */
interface Lit {
  warnings: number;
  dangers: number;
}

interface Placement {
  x: number;
  y: number;
  z: number;
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

/** A round patch of black that fades out to its edge: stretched, the shadow under anything. */
function createShadowTexture(three: ThreeModule): TextureLike {
  const size = 64;
  const patch = document.createElement("canvas");
  patch.width = size;
  patch.height = size;
  const context = patch.getContext("2d");
  if (context !== null) {
    const fade = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    fade.addColorStop(0, "rgba(0, 0, 0, 1)");
    fade.addColorStop(0.45, "rgba(0, 0, 0, 0.7)");
    fade.addColorStop(0.75, "rgba(0, 0, 0, 0.18)");
    fade.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = fade;
    context.fillRect(0, 0, size, size);
  }
  return new three.CanvasTexture(patch);
}

function createMaterials(three: ThreeModule, shadow: TextureLike): Materials {
  const lit = () => new three.MeshLambertMaterial({ color: WHITE });
  return {
    roomFloor: lit(),
    wall: new three.MeshLambertMaterial({ color: WHITE, transparent: true, depthWrite: false }),
    rail: lit(),
    desk: lit(),
    // Unlit, like a screen: a whiteboard is the brightest thing in its room.
    board: new three.MeshBasicMaterial({ color: WHITE }),
    robotBody: lit(),
    robotHead: lit(),
    tinted: new three.MeshBasicMaterial({ color: WHITE }),
    shadow: new three.MeshBasicMaterial({
      color: "#000000",
      map: shadow,
      transparent: true,
      depthWrite: false,
    }),
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
  dummy.rotation.set(0, 0, 0);
  dummy.scale.set(at.sx ?? 1, at.sy ?? 1, at.sz ?? 1);
  dummy.updateMatrixWorld(true);
  return dummy;
}

function createLayers(three: ThreeModule, parent: Object3DLike, materials: Materials): Layers {
  const flat = new three.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const unitBox = new three.BoxGeometry(1, 1, 1);
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
    monitors: layer(
      new three.BoxGeometry(MONITOR_SIZE.width, MONITOR_SIZE.height, MONITOR_SIZE.depth),
      materials.tinted,
    ),
    bodies: layer(new three.CylinderGeometry(0.24, 0.33, 0.66, 14), materials.robotBody),
    heads: layer(new three.BoxGeometry(0.62, 0.48, 0.5), materials.robotHead),
    visors: layer(new three.BoxGeometry(0.48, 0.18, 0.04), materials.tinted),
    arms: layer(new three.BoxGeometry(0.12, 0.6, 0.12).translate(0, -0.3, 0), materials.robotBody),
    // Amber is round and red is a diamond, so the two lights differ without their colour.
    warnings: layer(new three.SphereGeometry(LIGHT_RADIUS, 16, 10), materials.tinted),
    // Eight faces, stretched: a diamond from the camera, with the round light's area.
    dangers: layer(
      new three.SphereGeometry(LIGHT_RADIUS, 4, 2).scale(1.25, 1.9, 1.25),
      materials.tinted,
    ),
    deskShadows: layer(flat, materials.shadow),
    shadows: layer(flat, materials.shadow),
  };
}

function createRig(three: ThreeModule): Rig {
  const part = (x: number, y: number, z: number) => {
    const object = new three.Object3D();
    object.position.set(x, y, z);
    return object;
  };
  const root = part(0, 0, 0);
  const hip = part(0, 0.35, 0);
  const body = part(0, 0.33, 0);
  const head = part(0, 0.96, 0);
  const visor = part(0, 0.97, 0.255);
  // The light hangs from the root, not the hip: it stays over the seat when the body leans, so
  // a slumped robot is seen under its light and not behind it.
  const light = part(0, LIGHT_Y, 0);
  const armLeft = part(-0.4, 0.62, 0);
  const armRight = part(0.4, 0.62, 0);
  hip.add(body, head, visor, armLeft, armRight);
  root.add(hip, light);
  return { root, hip, body, head, visor, light, armLeft, armRight };
}

/** The five glass segments of a room: back, left, right, and the front on each side of the door. */
function wallSegments(room: RoomPlan, y: number, height: number): Placement[] {
  const { x, z } = room.center;
  const halfWidth = ROOM_WIDTH / 2;
  const halfDepth = ROOM_DEPTH / 2;
  const frontWidth = (ROOM_WIDTH - DOOR_WIDTH) / 2 + WALL_THICKNESS / 2;
  const frontOffset = halfWidth + WALL_THICKNESS / 2 - frontWidth / 2;
  const across = { y, sy: height, sz: WALL_THICKNESS };
  const along = { y, z, sx: WALL_THICKNESS, sy: height, sz: ROOM_DEPTH - WALL_THICKNESS };
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
      sz: ROOM_DEPTH + rim,
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
  const { desks, monitors, deskShadows } = stage.layers;
  const all = deskPlans(plan);
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
  ensureCapacity(stage, monitors, all.length);
  all.forEach((desk, index) => {
    const screen = {
      x: desk.x + 0.2,
      y: DESK_SIZE.height + MONITOR_SIZE.height / 2 + 0.02,
      z: desk.z + 0.14,
    };
    monitors.mesh.setMatrixAt(index, place(stage.dummy, screen).matrixWorld);
    const color = desk.screenLit ? colors.monitorLit : colors.monitorDim;
    monitors.mesh.setColorAt(index, stage.tint.set(color));
  });
  finishLayer(monitors, all.length);
}

function truncate(context: CanvasRenderingContext2D, text: string, width: number): string {
  if (context.measureText(text).width <= width) return text;
  let cut = text;
  while (cut.length > 1 && context.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/**
 * Draws a name plate at `ratio` device pixels per CSS pixel and returns its size in CSS pixels.
 * The canvas is a whole number of device pixels, so the size may be a fraction of a CSS pixel.
 */
function drawLabel(
  canvas: HTMLCanvasElement,
  text: string,
  palette: ScenePalette,
  ratio: number,
): PlateSize {
  const context = canvas.getContext("2d");
  if (context === null) return { width: 0, height: 0 };
  const font = `500 ${LABEL.fontSize}px ${LABEL_FONT_STACK}`;
  context.font = font;
  const shown = truncate(context, text, LABEL.maxWidth - LABEL.paddingX * 2);
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

/** Where a room's name plate hangs: on the front glass, from the room's left corner. */
function labelAnchor(room: RoomPlan): WorldPoint {
  return {
    x: room.center.x - ROOM_WIDTH / 2,
    y: WALL_HEIGHT / 2,
    z: room.center.z + ROOM_DEPTH / 2,
  };
}

function roomBounds(room: RoomPlan): Bounds {
  return {
    minX: room.center.x - ROOM_WIDTH / 2 - ROOM_FRAME.side,
    maxX: room.center.x + ROOM_WIDTH / 2 + ROOM_FRAME.side,
    minZ: room.center.z - ROOM_DEPTH / 2 - ROOM_FRAME.back,
    maxZ: room.center.z + ROOM_DEPTH / 2 + ROOM_FRAME.front,
  };
}

/** An arm above the shoulder leans away from the head, so a raised hand shows beside it. */
function armSplay(angle: number): number {
  return Math.max(0, -Math.cos(angle)) * ARM_SPLAY;
}

/** The office's bounds, drawn in at the sides: on a phone every pixel of width is scale. */
function frameOf(bounds: Bounds): Bounds {
  const inset = Math.min(FRAME_INSET, (bounds.maxX - bounds.minX) / 4);
  return { ...bounds, minX: bounds.minX + inset, maxX: bounds.maxX - inset };
}

/** True when a room that both plans hold stands somewhere else: the grid was laid out again. */
function roomsMoved(before: ScenePlan, after: ScenePlan): boolean {
  const centers = new Map(before.rooms.map((room) => [room.roomId, room.center]));
  return after.rooms.some((room) => {
    const was = centers.get(room.roomId);
    return was !== undefined && (was.x !== room.center.x || was.z !== room.center.z);
  });
}

function distance(left: ScreenPoint, right: ScreenPoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
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

  const shadowTexture = createShadowTexture(three);
  const materials = createMaterials(three, shadowTexture);
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

  let plan: ScenePlan = { rooms: [], robots: [], bounds: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 } };
  let colors: ScenePalette | null = null;
  const enteredAt = new Map<string, number>();
  let viewport: Viewport = { width: 0, height: 0 };
  let ratio = 1;
  let view: CameraView = { x: 0, z: 0, zoom: 1 };
  let easing: { from: CameraView; to: CameraView; start: number } | null = null;
  /** True until the user or a focus request moves the camera: the view then follows the office. */
  let following = true;
  let framed = false;
  let pendingFocus: string | null = null;
  let onScreen = true;
  let visible = true;
  /** Set by dispose and by a lost context: after either, nothing is drawn again. */
  let stopped = false;
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
    const size = drawLabel(plate, room.label, palette, ratio);
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
      const lift = (dy * RISE_PER_SCREEN_UNIT) / perUnit;
      label.sprite.position.set(anchor.x + dx / perUnit, anchor.y - lift, anchor.z);
      label.sprite.scale.set(label.width / perUnit, label.height / perUnit, 1);
    }
  }

  function writeRobot(robot: RobotPlan, index: number, now: number, lit: Lit): void {
    const { bodies, heads, visors, arms, warnings, dangers, shadows } = layers;
    const entered = enteredAt.get(robot.agentId) ?? now;
    const motion = robotFrame(robot, entered, now, options.reducedMotion);
    rig.root.position.set(motion.x, motion.lift, motion.z);
    rig.root.rotation.set(0, motion.heading, 0);
    rig.hip.rotation.set(motion.lean, 0, 0);
    rig.armLeft.rotation.set(motion.armLeft, 0, -armSplay(motion.armLeft));
    rig.armRight.rotation.set(motion.armRight, 0, armSplay(motion.armRight));
    rig.root.updateMatrixWorld(true);
    bodies.mesh.setMatrixAt(index, rig.body.matrixWorld);
    heads.mesh.setMatrixAt(index, rig.head.matrixWorld);
    visors.mesh.setMatrixAt(index, rig.visor.matrixWorld);
    visors.mesh.setColorAt(index, stage.tint.set(robot.visor));
    arms.mesh.setMatrixAt(index * 2, rig.armLeft.matrixWorld);
    arms.mesh.setMatrixAt(index * 2 + 1, rig.armRight.matrixWorld);
    const shadow = {
      x: motion.x,
      y: FLAT_STEP * 2,
      z: motion.z,
      sx: ROBOT_SHADOW.width,
      sz: ROBOT_SHADOW.depth,
    };
    shadows.mesh.setMatrixAt(index, place(stage.dummy, shadow).matrixWorld);
    if (robot.light === null) return;
    // The pose says which light it is: a raised hand waits for the owner, a slump failed.
    const danger = robot.pose === "slumped";
    const layer = danger ? dangers : warnings;
    const slot = danger ? lit.dangers : lit.warnings;
    layer.mesh.setMatrixAt(slot, rig.light.matrixWorld);
    layer.mesh.setColorAt(slot, stage.tint.set(robot.light));
    if (danger) lit.dangers += 1;
    else lit.warnings += 1;
  }

  function writeRobots(now: number): void {
    const { bodies, heads, visors, arms, warnings, dangers, shadows } = layers;
    const count = plan.robots.length;
    for (const layer of [bodies, heads, visors, warnings, dangers, shadows]) {
      ensureCapacity(stage, layer, count);
    }
    ensureCapacity(stage, arms, count * 2);
    // Zoomed out, a light at its true size is a pixel or two: it grows to stay findable, and
    // rises so that its lower edge stays where it was on screen, clear of the head.
    const grow = Math.max(1, LIGHT_MIN_PX / (LIGHT_RADIUS * pixelsPerUnit(view, viewport)));
    rig.light.position.set(0, LIGHT_Y + LIGHT_RADIUS * (grow - 1) * RISE_PER_SCREEN_UNIT, 0);
    rig.light.scale.set(grow, grow, grow);
    const lit: Lit = { warnings: 0, dangers: 0 };
    plan.robots.forEach((robot, index) => writeRobot(robot, index, now, lit));
    for (const layer of [bodies, heads, visors, shadows]) finishLayer(layer, count);
    finishLayer(arms, count * 2);
    finishLayer(warnings, lit.warnings);
    finishLayer(dangers, lit.dangers);
  }

  function draw(now: number): { easing: boolean; need: AnimationNeed } {
    const moving = applyCamera(now);
    placeLabels();
    writeRobots(now);
    renderer.render(scene, camera);
    const need = animationNeed(plan.robots, enteredAt, now, options.reducedMotion);
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

  /** The camera on one room: as close as a focus goes, but never so close the room is cut. */
  function roomView(room: RoomPlan): CameraView {
    const whole = frameBounds(roomBounds(room), viewport);
    return { x: whole.x, z: whole.z, zoom: Math.min(whole.zoom, focusOn(view, room.center).zoom) };
  }

  /**
   * Puts the whole office in frame, for as long as nobody has moved the camera: at first, when
   * the container changes size, and when rooms come or go. A room asked for before the first
   * framing is framed instead.
   */
  function frameOffice(ease: boolean): void {
    if (!following || viewport.width === 0 || plan.rooms.length === 0) return;
    const room = plan.rooms.find((candidate) => candidate.roomId === pendingFocus);
    const next = room ? roomView(room) : frameBounds(frameOf(plan.bounds), viewport);
    if (room) {
      following = false;
      pendingFocus = null;
    }
    const target = easing?.to ?? view;
    const same = next.x === target.x && next.z === target.z && next.zoom === target.zoom;
    if (framed && same) return;
    if (ease && framed) moveTo(next);
    else setView(next);
    framed = true;
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

  function labelUnder(at: ScreenPoint, reach: number): string | null {
    for (const [roomId, label] of labels) {
      const left = screenPoint(view, viewport, label.anchor);
      const inX = at.x >= left.x - reach && at.x <= left.x + label.width + reach;
      const inY = Math.abs(at.y - left.y) <= label.height / 2 + reach;
      if (inX && inY) return roomId;
    }
    return null;
  }

  function robotNear(at: ScreenPoint, now: number): RobotPlan | null {
    let nearest: RobotPlan | null = null;
    let best = TAP_RADIUS_PX;
    for (const robot of plan.robots) {
      const entered = enteredAt.get(robot.agentId) ?? now;
      const motion = robotFrame(robot, entered, now, options.reducedMotion);
      const chest: WorldPoint = { x: motion.x, y: motion.lift + CHEST_Y, z: motion.z };
      const gap = distance(at, screenPoint(view, viewport, chest));
      if (gap <= best) {
        best = gap;
        nearest = robot;
      }
    }
    return nearest;
  }

  /**
   * What a tap or a click at `at` means. Zoomed out, a robot is a few pixels wide, so a tap takes
   * the nearest robot within a touch target's reach. A plate under the finger wins, since it is
   * drawn over everything; a plate merely nearby loses to a robot.
   */
  function targetAt(at: ScreenPoint): { roomId: string } | { agentId: string } | null {
    const plate = labelUnder(at, 0);
    if (plate !== null) return { roomId: plate };
    const robot = robotNear(at, performance.now());
    if (robot) return { agentId: robot.agentId };
    const nearby = labelUnder(at, TAP_RADIUS_PX - LABEL.height / 2);
    return nearby === null ? null : { roomId: nearby };
  }

  function canvasPoint(event: { clientX: number; clientY: number }): ScreenPoint {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  const pointers = new Map<number, ScreenPoint>();
  let gesture: { start: ScreenPoint; moved: boolean; multi: boolean } | null = null;
  let pinch: { spread: number; middle: ScreenPoint } | null = null;

  function pinchState(): { spread: number; middle: ScreenPoint } | null {
    const [first, second] = [...pointers.values()];
    if (!first || !second || pointers.size !== 2) return null;
    return {
      spread: distance(first, second),
      middle: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
    };
  }

  /** Zooms by `factor` and keeps the ground under `at` where it is on screen. */
  function zoomAbout(from: CameraView, factor: number, at: ScreenPoint): CameraView {
    const zoomed = zoomBy(from, factor);
    const applied = zoomed.zoom / from.zoom - 1;
    const dx = (at.x - viewport.width / 2) * applied;
    const dy = (at.y - viewport.height / 2) * applied;
    return panBy(zoomed, -dx, -dy, viewport, plan.bounds);
  }

  function takeCamera(next: CameraView): void {
    following = false;
    pendingFocus = null;
    setView(next);
  }

  function onPointerDown(event: PointerEvent): void {
    // Only the main mouse button pans and picks; touch and pen always report button 0.
    if (event.button !== 0) return;
    canvas.setPointerCapture(event.pointerId);
    const at = canvasPoint(event);
    pointers.set(event.pointerId, at);
    if (pointers.size === 1) {
      gesture = { start: at, moved: false, multi: false };
    } else if (gesture) {
      gesture.multi = true;
    }
    pinch = pinchState();
  }

  function onPointerMove(event: PointerEvent): void {
    const at = canvasPoint(event);
    const last = pointers.get(event.pointerId);
    if (!last) {
      canvas.style.cursor = targetAt(at) === null ? "grab" : "pointer";
      return;
    }
    pointers.set(event.pointerId, at);
    if (gesture && distance(at, gesture.start) > TAP_SLOP_PX) gesture.moved = true;
    if (pointers.size === 1 && gesture?.moved) {
      canvas.style.cursor = "grabbing";
      takeCamera(panBy(view, at.x - last.x, at.y - last.y, viewport, plan.bounds));
      return;
    }
    const next = pinchState();
    if (next !== null && pinch !== null && pinch.spread > 0) {
      const zoomed = zoomAbout(view, next.spread / pinch.spread, next.middle);
      const dx = next.middle.x - pinch.middle.x;
      const dy = next.middle.y - pinch.middle.y;
      takeCamera(panBy(zoomed, dx, dy, viewport, plan.bounds));
    }
    pinch = next;
  }

  function pick(at: ScreenPoint): void {
    const target = targetAt(at);
    if (target === null) return;
    if ("agentId" in target) options.onSelectAgent(target.agentId);
    else focusRoom(target.roomId);
  }

  function onPointerUp(event: PointerEvent): void {
    pointers.delete(event.pointerId);
    if (gesture && pointers.size === 0) {
      const tap = !gesture.moved && !gesture.multi && event.type === "pointerup";
      gesture = null;
      canvas.style.cursor = "grab";
      if (tap) pick(canvasPoint(event));
    }
    pinch = pinchState();
  }

  function onWheel(event: WheelEvent): void {
    event.preventDefault();
    takeCamera(zoomAbout(view, wheelFactor(event.deltaY), canvasPoint(event)));
  }

  function onContextLost(event: Event): void {
    event.preventDefault();
    stopped = true;
    cancelFrames();
    options.onContextLost();
  }

  function onVisibility(): void {
    refreshVisible();
  }

  function focusRoom(roomId: string): void {
    const room = plan.rooms.find((candidate) => candidate.roomId === roomId);
    if (!room || !framed) {
      pendingFocus = roomId;
      return;
    }
    following = false;
    moveTo(roomView(room));
  }

  const resizeObserver = new ResizeObserver(() => resizeToContainer());
  resizeObserver.observe(container);
  const intersectionObserver = new IntersectionObserver((entries) => {
    onScreen = entries.some((entry) => entry.isIntersecting);
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
      for (const robot of nextPlan.robots) {
        if (!enteredAt.has(robot.agentId)) enteredAt.set(robot.agentId, now);
      }
      const present = new Set(nextPlan.robots.map((robot) => robot.agentId));
      for (const agentId of enteredAt.keys()) if (!present.has(agentId)) enteredAt.delete(agentId);
      // After a new grid (a phone turned on its side) the old view shows the wrong place, and an
      // office that emptied is framed again when its rooms come back. Both jump, without easing.
      if (roomsMoved(plan, nextPlan) || nextPlan.rooms.length === 0) {
        following = true;
        framed = false;
      }
      plan = nextPlan;
      colors = nextPalette;
      applyPalette(materials, nextPalette);
      background.set(nextPalette.background);
      writeRooms(stage, nextPlan.rooms);
      writeDesks(stage, nextPlan, nextPalette);
      writeLabels(nextPalette);
      frameOffice(true);
      if (pendingFocus !== null && framed) focusRoom(pendingFocus);
      invalidate();
    },
    focusRoom(roomId) {
      focusRoom(roomId);
    },
    focusAgent(agentId) {
      const robot = plan.robots.find((candidate) => candidate.agentId === agentId);
      if (!robot || !framed) return;
      following = false;
      moveTo(focusOn(view, robot.seat));
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
      shadowTexture.dispose();
      // The listener is gone, so this does not report a lost context; it frees the context now
      // instead of when the canvas is collected (browsers cap live contexts).
      renderer.forceContextLoss();
      renderer.dispose();
      canvas.remove();
    },
  };
}
