// PASEO: stand-in for my-office's world/backdrops/city.js (the street outside), which Paseo does
// not take. One texture of it is used indoors: the soft dot of the point lights.
import { canvasTex } from '../../scene/blocks.js';

export const dotTex = canvasTex(32, 32, (g) => {
  const r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.4, 'rgba(255,255,255,.7)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 32, 32);
});
