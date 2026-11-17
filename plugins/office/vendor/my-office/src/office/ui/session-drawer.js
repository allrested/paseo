// PASEO: stand-in for my-office's ui/session-drawer.js. Upstream opens its own drawer for a
// chosen session; here the choice goes to Paseo, which shows its agent card.
import { state } from '../core/state.js';
import { BASE_ZOOM, camera } from '../scene/renderer.js';
import { focusTarget } from '../core/loop.js';
import { sessions, workers } from '../people/workers.js';
import { host } from '../paseo-host.js';
import { setView } from './camera-bar.js';

/** The camera's place before someone was chosen: it goes back there when nobody is. */
let before = null;

/**
 * Marks the person in the scene; `tell` is false when Paseo itself made the choice. With `open`,
 * Paseo opens their session instead, where it can (`host.open`).
 */
export function openSession(id, opts = {}) {
  if (!sessions.has(id)) return;
  // PASEO: walking in (interact/first-person.js) opens the session beside the floor and stays where it is.
  if (opts.open && host.open) { host.open(id); return; }
  const same = state.selectedId === id;
  if (!state.selectedId && focusTarget) before = { target: focusTarget.clone(), zoom: state.zoomGoal ?? camera.zoom };
  state.selectedId = id;
  setView(null);
  const waver = workers.get(id);
  if (waver && !same) waver.waveUntil = state.sim + 1.8;
  if (waver && focusTarget) focusTarget.set(waver.pos.x, 0.9, waver.pos.y);
  state.zoomGoal = 1.6 * BASE_ZOOM;
  if (opts.tell !== false) host.select(id);
}
export function closeSession(opts = {}) {
  if (!state.selectedId) return;
  state.selectedId = null;
  if (before && focusTarget) { focusTarget.copy(before.target); state.zoomGoal = before.zoom; }
  before = null;
  if (opts.tell !== false) host.select(null);
}
export function toggleSession(id) { if (state.selectedId === id) closeSession(); else openSession(id); }
