// The part of three.js r170 the office scene uses, typed structurally: the library is evaluated at
// run time from the vendored bytes in ../../vendor, so its own types are not a dependency. Each
// member below exists in r170 with this shape.

export interface Vector2Like {
  x: number;
  y: number;
  set(x: number, y: number): this;
}

export interface Vector3Like {
  x: number;
  y: number;
  z: number;
  set(x: number, y: number, z: number): this;
}

export interface EulerLike {
  x: number;
  y: number;
  z: number;
  set(x: number, y: number, z: number): this;
}

export interface ColorLike {
  set(value: string): this;
}

/** Opaque here; the scene only passes matrices from objects to instanced meshes. */
export interface Matrix4Like {
  readonly elements: ArrayLike<number>;
}

export interface Object3DLike {
  position: Vector3Like;
  rotation: EulerLike;
  scale: Vector3Like;
  readonly matrixWorld: Matrix4Like;
  visible: boolean;
  renderOrder: number;
  add(...objects: Object3DLike[]): this;
  remove(...objects: Object3DLike[]): this;
  updateMatrixWorld(force?: boolean): void;
  lookAt(x: number, y: number, z: number): void;
}

export interface DisposableLike {
  dispose(): void;
}

export interface GeometryLike extends DisposableLike {
  rotateX(angle: number): this;
  translate(x: number, y: number, z: number): this;
  scale(x: number, y: number, z: number): this;
}

export interface MaterialLike extends DisposableLike {
  opacity: number;
  transparent: boolean;
  depthWrite: boolean;
}

export interface ColorMaterialLike extends MaterialLike {
  readonly color: ColorLike;
}

export interface TextureLike extends DisposableLike {
  needsUpdate: boolean;
  colorSpace: string;
}

export interface SpriteMaterialLike extends MaterialLike {
  map: TextureLike | null;
}

export interface BufferAttributeLike {
  needsUpdate: boolean;
}

export interface InstancedMeshLike extends Object3DLike, DisposableLike {
  count: number;
  frustumCulled: boolean;
  readonly instanceMatrix: BufferAttributeLike;
  readonly instanceColor: BufferAttributeLike | null;
  setMatrixAt(index: number, matrix: Matrix4Like): void;
  setColorAt(index: number, color: ColorLike): void;
  computeBoundingSphere(): void;
}

export type MeshLike = Object3DLike;

export interface SpriteLike extends Object3DLike {
  readonly center: Vector2Like;
  readonly material: SpriteMaterialLike;
}

export interface SceneLike extends Object3DLike {
  background: ColorLike | null;
}

export interface CameraLike extends Object3DLike {
  left: number;
  right: number;
  top: number;
  bottom: number;
  zoom: number;
  updateProjectionMatrix(): void;
}

export interface RendererLike extends DisposableLike {
  outputColorSpace: string;
  setPixelRatio(ratio: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  render(scene: SceneLike, camera: CameraLike): void;
  forceContextLoss(): void;
}

export interface IntersectionLike {
  readonly object: Object3DLike;
  readonly instanceId?: number;
}

export interface RaycasterLike {
  setFromCamera(coords: Vector2Like, camera: CameraLike): void;
  intersectObject(object: Object3DLike, recursive?: boolean): IntersectionLike[];
  intersectObjects(objects: Object3DLike[], recursive?: boolean): IntersectionLike[];
}

export interface MaterialOptions {
  color: string;
  map?: TextureLike;
  transparent?: boolean;
  opacity?: number;
  depthWrite?: boolean;
}

export interface ThreeModule {
  readonly REVISION: string;
  readonly SRGBColorSpace: string;
  readonly WebGLRenderer: new (parameters: {
    canvas: HTMLCanvasElement;
    antialias: boolean;
    alpha: boolean;
    powerPreference: "low-power" | "default" | "high-performance";
  }) => RendererLike;
  readonly Scene: new () => SceneLike;
  readonly Group: new () => Object3DLike;
  readonly Object3D: new () => Object3DLike;
  readonly OrthographicCamera: new (
    left: number,
    right: number,
    top: number,
    bottom: number,
    near: number,
    far: number,
  ) => CameraLike;
  readonly HemisphereLight: new (sky: string, ground: string, intensity: number) => Object3DLike;
  readonly DirectionalLight: new (color: string, intensity: number) => Object3DLike;
  readonly Color: new (value: string) => ColorLike;
  readonly Vector2: new (x: number, y: number) => Vector2Like;
  readonly BoxGeometry: new (width: number, height: number, depth: number) => GeometryLike;
  readonly CylinderGeometry: new (
    radiusTop: number,
    radiusBottom: number,
    height: number,
    radialSegments: number,
  ) => GeometryLike;
  readonly SphereGeometry: new (
    radius: number,
    widthSegments: number,
    heightSegments: number,
  ) => GeometryLike;
  readonly PlaneGeometry: new (width: number, height: number) => GeometryLike;
  readonly CircleGeometry: new (radius: number, segments: number) => GeometryLike;
  readonly ConeGeometry: new (
    radius: number,
    height: number,
    radialSegments: number,
  ) => GeometryLike;
  readonly MeshLambertMaterial: new (options: MaterialOptions) => ColorMaterialLike;
  readonly MeshBasicMaterial: new (options: MaterialOptions) => ColorMaterialLike;
  readonly SpriteMaterial: new (options: {
    map: TextureLike;
    transparent: boolean;
    depthWrite: boolean;
    depthTest?: boolean;
  }) => SpriteMaterialLike;
  readonly Mesh: new (geometry: GeometryLike, material: MaterialLike) => MeshLike;
  readonly InstancedMesh: new (
    geometry: GeometryLike,
    material: MaterialLike,
    count: number,
  ) => InstancedMeshLike;
  readonly Sprite: new (material: SpriteMaterialLike) => SpriteLike;
  readonly CanvasTexture: new (canvas: HTMLCanvasElement) => TextureLike;
  readonly Raycaster: new () => RaycasterLike;
}

export const THREE_REVISION = "170";

/** Every constructor in ThreeModule; the guard checks each is a function. */
export const THREE_EXPORTS: readonly (keyof ThreeModule)[] = [
  "WebGLRenderer",
  "Scene",
  "Group",
  "Object3D",
  "OrthographicCamera",
  "HemisphereLight",
  "DirectionalLight",
  "Color",
  "Vector2",
  "BoxGeometry",
  "CylinderGeometry",
  "SphereGeometry",
  "PlaneGeometry",
  "CircleGeometry",
  "ConeGeometry",
  "MeshLambertMaterial",
  "MeshBasicMaterial",
  "SpriteMaterial",
  "Mesh",
  "InstancedMesh",
  "Sprite",
  "CanvasTexture",
  "Raycaster",
];

/** True for the r170 module namespace (or anything with the same exports). */
export function isThreeModule(value: unknown): value is ThreeModule {
  if (typeof value !== "object" || value === null) return false;
  if (Reflect.get(value, "REVISION") !== THREE_REVISION) return false;
  if (typeof Reflect.get(value, "SRGBColorSpace") !== "string") return false;
  return THREE_EXPORTS.every((name) => typeof Reflect.get(value, name) === "function");
}
