// PASEO: stand-in for my-office's ui/camera-bar.js. Upstream's bar of named views, its zoom and its
// full screen are taken; its automatic camera, first person and list mode are not. One view is
// Paseo's own: the whole floor, fitted to the frame. Upstream's opening view is sized for its own
// page; Paseo's frame is a screen or a workspace tab of any shape, so Overview is that fitted view
// and the other three are upstream's places at a factor of its zoom.
// Photo mode's bar is built here too: upstream's PhotoBar.tsx is React, and photo mode's own
// ui/photo.js finds its elements by id.
import * as THREE from '../../../three/three.module.min.js';
import { state } from '../core/state.js';
import { camera, controls } from '../scene/renderer.js';
import { focusTarget } from '../core/loop.js';
import { floorBounds } from '../interact/first-person.js';
import { closeSession } from './session-drawer.js';
import { host } from '../paseo-host.js';

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

const $ = (id) => document.getElementById(id);

/** The view is still the fitted one: nobody moved the camera and no place took it. */
let home = false;
/** The fitted view's zoom: the percent and the other views' factors are read from it. */
let fitZoom = 0;

/**
 * Upstream's views for the company floor, each a place to look at and a factor of the fitted zoom.
 * Overview is Paseo's own and is fitted, so it is not in the table.
 */
const VIEWS = { desks: { t: [2.3, 0.6, 3.6], z: 1.9 }, meeting: { t: [-1.2, 0.6, -5.4], z: 2.0 }, server: { t: [-5.6, 1.0, -0.6], z: 2.4 } };

/** The toolbar's and the photo bar's markup, as upstream's CameraToolbar.tsx and PhotoBar.tsx draw it. */
const BAR = `
    <div class="toolbar" role="toolbar" aria-label="View">
      <div class="tb-seg">
        <button type="button" class="seg-btn" data-view="home" aria-label="Overview" title="Overview" aria-pressed="true"><span data-icon="home"></span><span>Overview</span></button>
        <button type="button" class="seg-btn" data-view="desks" aria-label="Desks" title="Desks" aria-pressed="false"><span data-icon="monitor"></span><span>Desks</span></button>
        <button type="button" class="seg-btn" data-view="meeting" aria-label="Meeting room" title="Meeting room" aria-pressed="false"><span data-icon="users"></span><span>Meeting room</span></button>
        <button type="button" class="seg-btn" data-view="server" aria-label="Servers" title="Servers" aria-pressed="false"><span data-icon="server"></span><span>Servers</span></button>
      </div>
      <div class="tb-zoom"><button type="button" id="zoom-out" aria-label="Zoom out" title="Zoom out"><span data-icon="minus"></span></button><span id="zoom-val">100%</span><button type="button" id="zoom-in" aria-label="Zoom in" title="Zoom in"><span data-icon="plus"></span></button></div>
      <div class="tb-tools">
        <button type="button" class="tb-full" id="btn-full" aria-label="Full screen" title="Full screen"><span data-icon="maximize"></span></button>
        <button type="button" class="tb-full" id="btn-photo" aria-label="Photo mode" title="Photo mode"><span data-icon="camera"></span></button>
      </div>
    </div>
    <div class="photo-bar" id="photo-bar" hidden role="toolbar" aria-label="Photo mode">
      <p class="photo-hint">Drag to move · right-drag to turn · scroll to zoom where you point · P or Esc to leave</p>
      <div class="pb-row">
        <button type="button" class="pb-tgl" id="ph-names" aria-pressed="true">Names</button>
        <button type="button" class="pb-tgl" id="ph-mark" aria-pressed="true">Logo</button>
        <span class="pb-sep"></span>
        <div class="pb-seg" title="Picture size"><button type="button" data-ph-size="screen" aria-pressed="false">Screen</button><button type="button" data-ph-size="fhd" aria-pressed="true">Full HD</button><button type="button" data-ph-size="4k" aria-pressed="false">4K</button></div>
        <button type="button" class="pb-shoot" id="ph-shoot"><span data-icon="camera"></span><span>Take photo</span></button>
        <button type="button" class="pb-exit" id="ph-exit" aria-label="Leave photo mode" title="Leave photo mode"><span data-icon="x"></span></button>
      </div>
    </div>`;

/**
 * Upstream's styles/stage.css lines 9 to 26 and its photo bar, with its colours as literals: Paseo's
 * ink and muted are dark in the light theme, and would not read on this near-black track. Only the
 * accent is the app's, where it stays legible on it.
 */
const STYLE = `
.toolbar { position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%); display: flex; align-items: center; gap: 6px; padding: 6px; background: rgba(15, 20, 28, .84); -webkit-backdrop-filter: blur(16px) saturate(1.3); backdrop-filter: blur(16px) saturate(1.3); border: 1px solid rgba(255, 255, 255, .13); border-radius: 15px; box-shadow: 0 12px 32px rgba(0, 0, 0, .42), inset 0 1px 0 rgba(255, 255, 255, .05); z-index: 2; max-width: calc(100% - 24px); }
.toolbar.tb-pinned { left: auto; transform: none; }
.tb-seg, .tb-zoom, .tb-tools { display: flex; align-items: center; gap: 2px; height: 40px; padding: 3px; box-sizing: border-box; border-radius: 11px; background: rgba(255, 255, 255, .045); }
.seg-btn { all: unset; position: relative; height: 34px; display: inline-flex; align-items: center; padding: 0 10px; border-radius: 8px; font-size: .8rem; font-weight: 600; color: #8D97AA; cursor: pointer; white-space: nowrap; transition: background .18s, color .18s, padding .22s ease; }
/* the name slides out on hover (or keyboard focus) and stays out on the view you are on; the bar is centred, so the
   button grows round where it was and stays under the pointer */
.seg-btn > span:last-child { display: inline-block; max-width: 0; margin-left: 0; overflow: hidden; opacity: 0; transition: max-width .24s ease, margin-left .24s ease, opacity .16s ease; }
.seg-btn:hover > span:last-child, .seg-btn:focus-visible > span:last-child, .seg-btn[aria-pressed="true"] > span:last-child { max-width: 9em; margin-left: 7px; opacity: 1; }
.seg-btn:hover, .seg-btn:focus-visible { padding: 0 13px 0 10px; background: rgba(255, 255, 255, .07); color: #E8ECF4; }
.seg-btn[aria-pressed="true"] { padding: 0 13px 0 10px; background: #263040; color: #E8ECF4; box-shadow: 0 1px 2px rgba(0, 0, 0, .35), inset 0 0 0 1px rgba(255, 255, 255, .08); }
.seg-btn[aria-pressed="true"] svg { color: var(--o-accent, #EF8A5F); }
.seg-btn:focus-visible { outline: 2px solid var(--o-accent, #EF8A5F); }
.tb-zoom button, .tb-full { all: unset; width: 34px; height: 34px; display: grid; place-items: center; border-radius: 8px; cursor: pointer; color: #8D97AA; transition: background .15s, color .15s; }
.tb-zoom button:hover, .tb-full:hover { background: rgba(255, 255, 255, .07); color: #E8ECF4; }
.tb-full[aria-pressed="true"] { background: #263040; color: var(--o-accent, #EF8A5F); }
.tb-zoom button:focus-visible, .tb-full:focus-visible { outline: 2px solid var(--o-accent, #EF8A5F); }
.tb-zoom button, .tb-full { position: relative; }
.tb-zoom button::after, .tb-full::after { content: attr(aria-label); position: absolute; left: 50%; bottom: calc(100% + 12px); transform: translate(-50%, 4px); padding: 5px 9px; border-radius: 7px; background: #0B1018; border: 1px solid rgba(255, 255, 255, .13); color: #E8ECF4; font: 600 .72rem/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; white-space: nowrap; pointer-events: none; opacity: 0; transition: opacity .15s, transform .15s; box-shadow: 0 6px 16px rgba(0, 0, 0, .4); }
.tb-zoom button:hover::after, .tb-full:hover::after, .tb-zoom button:focus-visible::after, .tb-full:focus-visible::after { opacity: 1; transform: translate(-50%, 0); transition-delay: .25s; }
@media (hover: none) { .tb-zoom button::after, .tb-full::after { display: none; } }
/* (upstream's ".tb-zoom span" also matched the icons' own wrappers inside the zoom buttons and pushed them off centre;
   the one span it was written for is the percent) */
#zoom-val { min-width: 42px; text-align: center; font-size: .76rem; font-weight: 600; font-variant-numeric: tabular-nums; }
/* Paseo's svg.ic carries no size (each label sets its own); the bar's icons are upstream's 16 px. */
.toolbar .ic, .photo-bar .ic { width: 16px; height: 16px; flex: none; }
@media (max-width: 520px) { .seg-btn > span:last-child { display: none; } }
body.is-photo .toolbar { display: none; }
/* Photo mode: the office alone, with one bar to frame and take the picture */
body.is-photo #stage-wrap > :not(#stage):not(#photo-bar) { display: none !important; }
/* people's names only: no bubbles, chips, warnings or the cat's meow */
body.is-photo .labels > :not(.tag), body.is-photo .labels > .tag--lost, body.is-photo .labels > .cat-say, body.is-photo .labels > .tag--me { display: none !important; }
body.is-photo.photo-nonames .labels { display: none !important; }
.photo-bar { position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 6; display: grid; gap: 8px; justify-items: center; width: max-content; max-width: calc(100% - 24px); }
.photo-hint { margin: 0; font-size: .74rem; color: #EEF1F7; background: rgba(14, 19, 27, .6); padding: 4px 10px; border-radius: 999px; text-align: center; }
.pb-row { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 8px; background: rgba(14, 19, 27, .88); border: 1px solid rgba(255, 255, 255, .12); border-radius: 16px; padding: 8px; box-shadow: 0 14px 34px rgba(0, 0, 0, .45); backdrop-filter: blur(8px); }
.pb-sep { width: 1px; height: 26px; background: rgba(255, 255, 255, .12); }
.pb-tgl, .pb-seg button, .pb-exit { font: 600 .78rem/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #C9D1E0; background: transparent; border: 1px solid rgba(255, 255, 255, .14); border-radius: 10px; padding: 8px 11px; cursor: pointer; }
.pb-tgl[aria-pressed="true"], .pb-seg button[aria-pressed="true"] { color: #fff; background: rgba(232, 134, 95, .2); border-color: rgba(232, 134, 95, .7); }
.pb-seg { display: flex; gap: 4px; }
.pb-shoot { display: inline-flex; align-items: center; gap: 7px; font: 700 .84rem/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1A1206; background: #F2B33D; border: 0; border-radius: 11px; padding: 10px 16px; cursor: pointer; }
.pb-shoot:disabled { opacity: .6; cursor: progress; }
`;

/** Marks the view the camera is on; `null` when it left it (a drag, a zoom, a person, a place's card). */
export function setView(view) {
  home = view === 'home';
  for (const b of document.querySelectorAll('.seg-btn')) b.setAttribute('aria-pressed', String(b.dataset.view === view));
}

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
  fitZoom = camera.zoom;
  home = true;
}

/** Flies to a view: Overview is the fitted floor, the others are upstream's places at a factor of its zoom. */
export function goView(view) {
  if (view === 'home') { fitFloor(); setView('home'); return; }
  const V = VIEWS[view];
  if (!V || !focusTarget) return;
  focusTarget.set(...V.t);
  state.zoomGoal = THREE.MathUtils.clamp(V.z * fitZoom, controls.minZoom, controls.maxZoom);
  setView(view);
}

/** Builds the bar's and the photo bar's markup and styles, before the modules that fill and wire them. */
export function build() {
  const style = document.createElement('style');
  style.textContent = STYLE;
  const wrap = document.getElementById('stage-wrap');
  wrap.append(style);
  wrap.insertAdjacentHTML('beforeend', BAR);
}

/** Run by paseo-entry.js once the loop is set up. */
export function setup() {
  /* ---------- camera toolbar ---------- */
  fitFloor();
  // While the mouse is on the toolbar it is held by its right edge: a view's name sliding out (on hover) then grows it to
  // the left, and the zoom and the tools stay where the pointer expects them. Centred again once it has shrunk.
  const bar = document.querySelector('.toolbar'), wrap = bar.parentElement;
  let unpin = 0;
  bar.addEventListener('pointerenter', (e) => {
    if (e.pointerType !== 'mouse') return;
    clearTimeout(unpin);
    if (bar.classList.contains('tb-pinned')) return;
    bar.style.right = `${wrap.getBoundingClientRect().right - bar.getBoundingClientRect().right}px`; bar.classList.add('tb-pinned');
  });
  bar.addEventListener('pointerleave', () => { clearTimeout(unpin); unpin = setTimeout(() => { bar.classList.remove('tb-pinned'); bar.style.right = ''; }, 340); });
  document.querySelector('.tb-seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]'); if (!b) return;
    if (state.selectedId) closeSession();
    goView(b.dataset.view);
  });
  $('zoom-in').addEventListener('click', () => { state.zoomGoal = Math.min(controls.maxZoom, (state.zoomGoal ?? camera.zoom) * 1.2); });
  $('zoom-out').addEventListener('click', () => { state.zoomGoal = Math.max(controls.minZoom, (state.zoomGoal ?? camera.zoom) / 1.2); });
  if (!document.fullscreenEnabled) $('btn-full').hidden = true;
  $('btn-full').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => host.toast("This browser won't go full screen."));
  });
  document.addEventListener('fullscreenchange', () => $('btn-full').setAttribute('aria-pressed', String(!!document.fullscreenElement)));
  setInterval(() => { const v = `${Math.round((camera.zoom / (fitZoom || 1)) * 100)}%`, z = $('zoom-val'); if (z.textContent !== v) z.textContent = v; }, 200);   // (written only when it changes: a write costs a style pass)
  // (made after the renderer's own observer, so the frustum already has the frame's new shape)
  new ResizeObserver(() => { if (home && !state.selectedId) fitFloor(); }).observe(document.getElementById('stage'));
}
