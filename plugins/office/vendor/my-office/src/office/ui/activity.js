// PASEO: stand-in for my-office's ui/activity.js (its session list and activity feed). The
// scene-facing parts stay: the rings and name tags of updateMarkers, which is upstream's.
import { state } from '../core/state.js';
import { hoverRing, selRing } from '../interact/rings.js';
import { sessions, workers } from '../people/workers.js';
import { host } from '../paseo-host.js';

export const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);
export function toast(message) { host.toast(String(message ?? '')); }
/** Upstream redraws its panels; here only the whiteboard has something to redraw. */
export function queueUi() { state.boardDirty = true; }
export function renderHud() {}
export function addFeed() {}

export function updateMarkers(t) {
  const sel = state.selectedId ? workers.get(state.selectedId) : null;
  selRing.visible = !!sel;
  if (sel) { selRing.position.set(sel.pos.x, 0.03 + sel.gy(), sel.pos.y); selRing.scale.setScalar(1 + Math.sin(t * 4) * 0.06); }
  hoverRing.visible = !!state.hovered && state.hovered !== sel && !!state.hovered.root.parent;
  if (hoverRing.visible) { hoverRing.position.set(state.hovered.pos.x, 0.025 + state.hovered.gy(), state.hovered.pos.y); hoverRing.scale.setScalar(state.hovered.sub ? 0.8 : 1); }
  for (const w of workers.values()) {
    const s = sessions.get(w.id);
    const show = w.root.visible && (!s || s.status !== 'rest' || w.id === state.selectedId || w === state.hovered || w.phase === 'walk');
    if (w.tagObj.visible !== show) w.tagObj.visible = show;
    const wait = s?.status === 'wait';
    if (w.tagEl.classList.contains('tag--wait') !== wait) w.tagEl.classList.toggle('tag--wait', wait);
  }
}
