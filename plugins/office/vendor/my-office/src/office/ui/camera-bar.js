// PASEO: stand-in for my-office's ui/camera-bar.js. Upstream's bar of named views and zoom buttons
// is not taken. One view is: the whole floor, fitted to the frame. Upstream's opening view is
// sized for its own page; Paseo's frame is a screen or a workspace tab of any shape.
import * as THREE from '../../../three/three.module.min.js';
import { state } from '../core/state.js';
import { camera, controls } from '../scene/renderer.js';
import { focusTarget } from '../core/loop.js';
import { floorBounds } from '../interact/first-person.js';

/** The floor's plinth past its walkable bounds, the foot of the plinth and the top of the walls. */
const PLINTH = 1.5, FOOT = -1.3, WALL = 3.4;
/** The share of the frame the floor fills: the rest is air around it. */
const FILL = 0.94;
/**
 * A frame much taller than the floor's shape (a phone held upright) would show the whole floor
 * small. There the floor fills the height, up to this many times its fitted size, and a finger
 * moves along it.
 */
const COVER = 1.9;

/** The view is still the fitted one: nobody moved the camera and no place took it. */
let home = false;
/** core/loop.js and interact/place-cards.js say `null` when the camera leaves a named view. */
export function setView(view) { if (view === null) home = false; }

const corner = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(), ahead = new THREE.Vector3();

/** Looks at the floor: its box, seen from the camera's side, centred and as large as fits (see COVER). */
export function fitFloor() {
  const b = floorBounds();
  camera.updateMatrixWorld(); camera.updateProjectionMatrix();
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const x of [b.x0 - PLINTH, b.x1 + PLINTH]) for (const y of [FOOT, WALL]) for (const z of [b.z0 - PLINTH, b.z1 + PLINTH]) {
    corner.set(x, y, z).project(camera);
    x0 = Math.min(x0, corner.x); x1 = Math.max(x1, corner.x); y0 = Math.min(y0, corner.y); y1 = Math.max(y1, corner.y);
  }
  if (!Number.isFinite(x1 - x0) || x1 <= x0 || y1 <= y0) return;
  // the box's centre, from screen units to a move along the floor: sideways, and towards or away from the camera
  camera.matrixWorld.extractBasis(right, up, ahead);
  const halfW = (camera.right - camera.left) / 2 / camera.zoom, halfH = (camera.top - camera.bottom) / 2 / camera.zoom;
  ahead.set(up.x, 0, up.z).normalize();
  const move = right.multiplyScalar(((x0 + x1) / 2) * halfW).addScaledVector(ahead, (((y0 + y1) / 2) * halfH) / (ahead.dot(up) || 1));
  controls.target.add(move); camera.position.add(move);
  camera.zoom = THREE.MathUtils.clamp(camera.zoom * Math.min(2 / (y1 - y0), (2 / (x1 - x0)) * COVER) * FILL, controls.minZoom, controls.maxZoom);
  camera.updateProjectionMatrix(); controls.update();
  focusTarget.copy(controls.target); state.zoomGoal = null;
  home = true;
}

/** Run by paseo-entry.js once the loop is set up. */
export function setup() {
  fitFloor();
  // (made after the renderer's own observer, so the frustum already has the frame's new shape)
  new ResizeObserver(() => { if (home && !state.selectedId) fitFloor(); }).observe(document.getElementById('stage'));
}
