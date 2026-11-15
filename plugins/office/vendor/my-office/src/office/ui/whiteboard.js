// PASEO: stand-in for my-office's ui/whiteboard.js. Upstream's board lists its sessions' tasks and
// the user's sticky notes; here it lists what Paseo's agents are doing, drawn in upstream's style,
// and a tap on it opens Paseo's own board. The picking of people and furniture is upstream's.
import * as THREE from '../../../three/three.module.min.js';
import { state } from '../core/state.js';
import { V2 } from '../core/env.js';
import { camera, renderer } from '../scene/renderer.js';
import { boardFace } from '../world/furniture/board.js';
import { director } from '../people/director.js';
import { toggleSession } from './session-drawer.js';
import { openMac } from './mac-drawer.js';
import { activateProp, buildProps, pickPerson, pickProp, setHoverProp } from '../interact/props.js';
import * as errands from '../people/errands.js';
import { closePlace, openPlace } from '../interact/place-cards.js';
import { host } from '../paseo-host.js';

const BW = 1200, BH = 520;
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const INK = '#22304A', MUTED = '#6B7486', DONE = '#2E9E62', WAIT = '#E0912A';
let boardCanvas, boardTexture, boardAt = 0, boardSig = '';

function fit(g, text, max) {
  if (g.measureText(text).width <= max) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (g.measureText(text.slice(0, m) + '…').width <= max) lo = m; else hi = m - 1; }
  return text.slice(0, lo).trimEnd() + '…';
}
function drawBoard(t) {
  const rows = host.boardRows();
  const pulsing = state.boardPulse.until > t;
  const sig = JSON.stringify(rows);
  if (sig === boardSig && !pulsing) return;
  boardSig = pulsing ? '' : sig;
  const g = boardCanvas.getContext('2d');
  g.fillStyle = '#FBFBF7'; g.fillRect(0, 0, BW, BH);
  g.fillStyle = 'rgba(43,58,85,.05)'; for (let i = 0; i < 9; i++) g.fillRect(0, 40 + i * 52, BW, 1);   // faint ruled lines
  const count = (k) => rows.filter((x) => x.state === k).length;
  g.fillStyle = INK; g.font = `800 46px ${FONT}`; g.fillText('Tasks', 40, 70);
  g.font = `600 22px ${FONT}`; g.fillStyle = MUTED;
  const sum = [count('doing') && `${count('doing')} at work`, count('wait') && `${count('wait')} waiting for you`, count('done') && `${count('done')} resting`].filter(Boolean).join(' · ');
  g.fillText(sum || 'Nobody is at work', 40, 104);
  const shown = rows.slice(0, 10);
  shown.forEach((x, i) => {
    const left = i < 5 ? 0 : 590, y = 132 + (i % 5) * 72;
    if (state.boardPulse.id === x.id && pulsing) { g.fillStyle = `rgba(255,214,102,${0.25 + 0.25 * Math.sin(t * 9)})`; g.fillRect(left + 28, y - 6, 552, 66); }
    g.lineWidth = 4; g.strokeStyle = x.state === 'done' ? DONE : x.state === 'wait' ? WAIT : INK;
    g.beginPath(); g.roundRect(left + 40, y + 6, 32, 32, 7); g.stroke();
    if (x.state === 'done') { g.fillStyle = DONE; g.fill(); g.strokeStyle = '#FFFFFF'; g.lineWidth = 4.5; g.beginPath(); g.moveTo(left + 47, y + 22); g.lineTo(left + 54, y + 30); g.lineTo(left + 66, y + 14); g.stroke(); }
    else if (x.state === 'wait') { g.fillStyle = WAIT; g.font = `900 26px ${FONT}`; g.textAlign = 'center'; g.fillText('!', left + 56, y + 32); g.textAlign = 'left'; }
    else { g.fillStyle = '#E8730E'; g.beginPath(); g.arc(left + 56, y + 22, 6 + Math.sin(t * 5) * 1.5, 0, 7); g.fill(); }
    g.fillStyle = x.color || INK; g.font = `800 19px ${FONT}`; g.fillText(fit(g, String(x.name || '').toUpperCase(), 480), left + 88, y + 16);
    g.font = `500 26px ${FONT}`; g.fillStyle = x.state === 'done' ? '#8A93A3' : INK;
    g.fillText(fit(g, String(x.text || ''), 480), left + 88, y + 48);
  });
  if (!shown.length) { g.fillStyle = '#8A93A3'; g.font = `500 24px ${FONT}`; g.fillText('What each agent is doing shows here.', 40, 170); }
  if (rows.length > shown.length) { g.fillStyle = MUTED; g.font = `600 20px ${FONT}`; g.fillText(`and ${rows.length - shown.length} more`, 40, BH - 22); }
  boardTexture.needsUpdate = true;
}
/** The whiteboard has no place card: its chip opens Paseo's board (paseo-entry.js gives the place its `open`). */
export function boardContent() { return null; }
export function updateBoard(t) {
  if ((state.boardDirty || state.boardPulse.until > t) && t - boardAt > (state.boardPulse.until > t ? 0.08 : 0.4)) { boardAt = t; state.boardDirty = false; drawBoard(t); }
}
export const ray = new THREE.Raycaster();
/** The racks and the wall screen open Paseo's machine panel; while it has none they are furniture. */
const MACHINE = new Set(['racks', 'tv']);
const pickUsableProp = () => { const pr = pickProp(); return pr && MACHINE.has(pr.prop.id) && !host.machine ? null : pr; };
let ndc;
let downAt = null;

export function setup() {
  state.todos ||= []; state.boardDirty = true;
  state.boardPulse = { id: null, until: 0 };
  boardCanvas = document.createElement('canvas');
  boardCanvas.width = BW; boardCanvas.height = BH;
  boardTexture = new THREE.CanvasTexture(boardCanvas);
  boardTexture.colorSpace = THREE.SRGBColorSpace;
  boardTexture.anisotropy = 8;
  boardFace.material.map = boardTexture;
  boardFace.material.needsUpdate = true;
  buildProps();
  /* picking people and furniture (upstream's, with Paseo's card in place of the drawer) */
  ndc = new V2();
  const aim = (e) => {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  };
  renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downAt) return;
    const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]); downAt = null;
    if (moved > 6) return;
    aim(e);
    const per = pickPerson(), pr = pickUsableProp();
    if (pr && (!per || pr.d < per.d - 0.3)) { if (pr.prop.id === 'board') host.board(); else activateProp(pr.prop); return; }
    if (!per) { closePlace(); return; }
    if (per.devBox) { openMac(); return; }   // (does nothing, and shows no hand, while host.machine is null)
    const w = per.worker;
    if (w && w === director) { openPlace('director'); return; }
    if (w?.sub) { if (w.parent) toggleSession(w.parent.id); return; }
    if (w && w.anim === 'sleep' && w.phase !== 'walk') w.poke();
    else if (w && state.selectedId !== w.id) errands.lookUp(w);
    if (w) toggleSession(w.id);
  });
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || e.buttons) return;
    const now = performance.now(); if (now - state.hoverAt < 60) return; state.hoverAt = now;
    aim(e);
    const per = pickPerson(), pr = pickUsableProp();
    const p = pr && (!per || pr.d < per.d - 0.3) ? pr.prop : null;
    state.hovered = !p && per?.worker ? per.worker : null;
    setHoverProp(p, e);
    renderer.domElement.classList.toggle('hovering', !!state.hovered || (!p && !!per?.devBox && !!host.machine) || !!p);
  });
  renderer.domElement.addEventListener('pointerleave', () => { state.hovered = null; setHoverProp(null); renderer.domElement.classList.remove('hovering'); });
}
