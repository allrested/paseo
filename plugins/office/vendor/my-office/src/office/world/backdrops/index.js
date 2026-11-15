// PASEO: stand-in for my-office's world/backdrops/index.js. Upstream chooses a street, a
// countryside or a beach; Paseo draws the floor on a plain backdrop in the app's surface colour.
import * as THREE from '../../../../three/three.module.min.js';
import { state } from '../../core/state.js';
import { scene } from '../../scene/renderer.js';
import { cityDay, cityNight } from '../windows.js';
import { setNight } from '../room-update.js';
import { host } from '../../paseo-host.js';

export let THEMES;
export let THEME;

/** The backdrop and the far haze take the app's surface colour, by day and by night. */
export function applySurface() {
  const colour = new THREE.Color(host.surface);
  THEME.sky = colour;
  THEME.fog = [host.surface, host.surface];
  scene.background = colour;
  if (scene.fog) scene.fog.color.copy(colour);
}
/** Night with Paseo's dark theme, day with the light one: never by the clock. */
export function applyNight(on) {
  state.nightManual = true;
  setNight(on);
  applySurface();
}
export function setup() {
  THEMES = { plain: { fog: [host.surface, host.surface], wins: [cityDay, cityNight], sky: new THREE.Color(host.surface), live: null } };
  THEME = THEMES.plain;
  applyNight(host.night);
}
