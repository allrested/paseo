// PASEO: stand-in for my-office's interact/first-person.js. Walking the office in first person is
// not taken. The collision grid is: navigation.js asks it where a person can stand. buildGrid,
// cellBlocked and blocked are upstream's, unchanged but for the floor's own bounds.
import * as THREE from '../../../three/three.module.min.js';
import { PRO } from '../core/env.js';
import { scene } from '../scene/renderer.js';

export const fp = { on: false, grid: null };
export function fpUpdate() {}

const CELL = 0.1;
/** The floor people walk on, in the scene's units. */
export const floorBounds = () => (PRO ? { x0: -7.85, x1: 15.3, z0: -7.85, z1: 11.3 } : { x0: -7.85, x1: 11.7, z0: -5.85, z1: 10.3 });
export function buildGrid() {
  const FPB = floorBounds();
  const W = Math.ceil((FPB.x1 - FPB.x0) / CELL), H = Math.ceil((FPB.z1 - FPB.z0) / CELL);
  const grid = new Uint8Array(W * H), box = new THREE.Box3();
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (!o.isMesh || !o.visible || o.isInstancedMesh) return;
    for (let q = o; q; q = q.parent) if (q.userData.worker || q.userData.dynamic || q.userData.noCollide || !q.visible) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    if (box.max.y < 0.15 || box.min.y > 1.4 || box.max.x - box.min.x > 25 || box.max.z - box.min.z > 25) return;
    const i0 = Math.max(0, Math.floor((box.min.x - FPB.x0) / CELL)), i1 = Math.min(W - 1, Math.floor((box.max.x - FPB.x0) / CELL));
    const j0 = Math.max(0, Math.floor((box.min.z - FPB.z0) / CELL)), j1 = Math.min(H - 1, Math.floor((box.max.z - FPB.z0) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) grid[j * W + i] = 1;
  });
  return { W, H, grid };
}
function cellBlocked(x, z) {
  const FPB = floorBounds();
  if (x < FPB.x0 || x >= FPB.x1 || z < FPB.z0 || z >= FPB.z1) return true;
  const g = fp.grid; return !!g.grid[Math.floor((z - FPB.z0) / CELL) * g.W + Math.floor((x - FPB.x0) / CELL)];
}
export function blocked(x, z, r = 0.2) {
  for (const [dx, dz] of [[0, 0], [-r, -r], [r, -r], [-r, r], [r, r], [r, 0], [-r, 0], [0, r], [0, -r]]) if (cellBlocked(x + dx, z + dz)) return true;
  return false;
}
