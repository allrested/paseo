// PASEO: stand-in for my-office's ui/camera-bar.js. Upstream's bar of named views, its zoom, its
// full screen and its Walk in button are taken; its automatic camera and list mode are not. One view
// is Paseo's own: the whole floor, fitted to the frame. Upstream's opening view is sized for its own
// page; Paseo's frame is a screen or a workspace tab of any shape, so Overview is that fitted view
// and the other three are upstream's places at a factor of its zoom.
// Photo mode's bar and the walk's overlay are built here too: upstream's PhotoBar.tsx and
// FirstPersonHud.tsx are React, and ui/photo.js and interact/first-person.js find their elements by id.
import * as THREE from '../../../three/three.module.min.js';
import { state } from '../core/state.js';
import { camera, controls, fpCam } from '../scene/renderer.js';
import { focusTarget } from '../core/loop.js';
import { exitFp, floorBounds, fp } from '../interact/first-person.js';
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

/**
 * The toolbar's, the walk's overlay's and the photo bar's markup, as upstream's CameraToolbar.tsx,
 * FirstPersonHud.tsx and PhotoBar.tsx draw them.
 */
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
      <button type="button" class="tb-fp" id="btn-fp" aria-pressed="false" aria-label="Walk in" title="Walk in"><span data-icon="walk"></span><span>Walk in</span></button>
    </div>
    <div class="fp-hud" id="fp-hud" hidden>
      <i class="fp-cross" aria-hidden="true"></i>
      <button type="button" class="fp-near" id="fp-near" hidden></button>
      <div class="fp-help"><b>Walking the office</b><span>W A S D to walk · drag to look · Shift to run · E to use what is in front of you (or wake someone up) · V to switch view · Esc to exit</span></div>
      <button type="button" class="fp-exit" id="fp-exit"><span data-icon="x"></span><span>Exit</span></button>
      <div class="fp-joy" id="fp-joy" aria-hidden="true"><i></i></div>
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
 * Upstream's styles/stage.css lines 9 to 26, its walk (lines 32 to 56, with the pool table's score,
 * and places.css's two `.is-fp` rules) and its photo bar, with its colours as literals: Paseo's ink
 * and muted are dark in the light theme, and would not read on these near-black panels. Only the
 * accent is the app's, where it stays legible on them.
 */
const STYLE = `
.toolbar { position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%); display: flex; align-items: center; gap: 6px; padding: 6px; color: #E8ECF4; background: rgba(15, 20, 28, .84); -webkit-backdrop-filter: blur(16px) saturate(1.3); backdrop-filter: blur(16px) saturate(1.3); border: 1px solid rgba(255, 255, 255, .13); border-radius: 15px; box-shadow: 0 12px 32px rgba(0, 0, 0, .42), inset 0 1px 0 rgba(255, 255, 255, .05); z-index: 2; max-width: calc(100% - 24px); }
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
.toolbar .ic, .photo-bar .ic, .fp-hud .ic { width: 16px; height: 16px; flex: none; }
@media (max-width: 520px) { .seg-btn > span:last-child { display: none; } }
/* (a narrow frame has no room for the last tool's name: at 390 px it ran past the right edge) */
@media (max-width: 520px) { .tb-zoom button::after, .tb-full::after { display: none; } }
/* Walk in: the button at the bar's end, and the overlay while walking (upstream's touch line and its fade to the
   street are not taken; the joystick stays hidden) */
.tb-fp { all: unset; height: 40px; display: inline-flex; align-items: center; gap: 8px; padding: 0 16px 0 13px; box-sizing: border-box; border-radius: 11px; background: var(--o-accent, #EF8A5F); color: #2A1307; font-size: .8rem; font-weight: 700; cursor: pointer; white-space: nowrap; box-shadow: 0 4px 14px rgba(239, 138, 95, .26), inset 0 1px 0 rgba(255, 255, 255, .28); transition: background .15s; }
.tb-fp:hover { background: #F5A07A; }
.tb-fp:focus-visible { outline: 2px solid var(--o-accent, #EF8A5F); outline-offset: 2px; }
.tb-fp[aria-pressed="true"] { background: rgba(239, 138, 95, .13); color: #F5A07A; box-shadow: inset 0 0 0 1px rgba(239, 138, 95, .6); }
.is-fp .tb-seg, .is-fp .tb-zoom { opacity: .35; }
.fp-hud { position: absolute; inset: 0; z-index: 3; pointer-events: none; }
.fp-cross { position: absolute; left: 50%; top: 50%; width: 6px; height: 6px; margin: -3px 0 0 -3px; border-radius: 50%; background: rgba(255, 255, 255, .85); box-shadow: 0 0 0 2px rgba(0, 0, 0, .35); }
.fp-help { position: absolute; left: 50%; top: 14px; transform: translateX(-50%); display: flex; gap: 10px; align-items: center; max-width: calc(100% - 140px); padding: 8px 14px; border-radius: 12px; background: rgba(17, 23, 32, .8); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); border: 1px solid rgba(255, 255, 255, .13); font-size: .76rem; color: #8D97AA; }
.fp-help b { color: #F2B544; white-space: nowrap; }
.fp-exit { all: unset; pointer-events: auto; position: absolute; right: 14px; top: 12px; height: 36px; display: inline-flex; align-items: center; gap: 6px; padding: 0 12px; border-radius: 10px; background: rgba(17, 23, 32, .86); border: 1px solid rgba(255, 255, 255, .13); color: #E8ECF4; font-size: .78rem; font-weight: 700; cursor: pointer; }
.fp-exit:hover { background: #1E2734; }
.fp-near { all: unset; pointer-events: auto; position: absolute; left: 50%; top: calc(50% + 34px); transform: translateX(-50%); padding: 8px 14px; border-radius: 999px; background: rgba(17, 23, 32, .9); border: 1px solid #3DDC84; color: #E8ECF4; font-size: .8rem; font-weight: 600; cursor: pointer; white-space: nowrap; max-width: 80%; overflow: hidden; text-overflow: ellipsis; }
.is-gaming .fp-near, .is-gaming .fp-cross, .is-gaming .fp-help { display: none !important; }   /* (on the sofa with a controller: the TV is the view) */
/* first person at the pool table (people/billiards.js): the score, whose shot it is, the power while Space is held, the keys */
.bil-hud { position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 6; display: grid; justify-items: center; gap: 6px; min-width: 260px; padding: 10px 16px; border-radius: 14px; background: rgba(10, 14, 22, .8); color: #FFFFFF; font-size: .8rem; pointer-events: none; }
.bil-hud .bil-score { font-size: .95rem; font-variant-numeric: tabular-nums; }
.bil-hud .bil-turn { color: #FFD27A; font-weight: 600; }
.bil-power { display: block; width: 220px; height: 8px; border-radius: 4px; background: rgba(255, 255, 255, .18); overflow: hidden; }
.bil-power > i { display: block; width: 0; height: 100%; background: linear-gradient(90deg, #4ADE80, #FACC15, #EF4444); }
.bil-hud .bil-help { color: #C9D4E3; font-size: .7rem; }
.fp-near kbd { display: inline-grid; place-items: center; min-width: 20px; height: 20px; margin-right: 8px; border-radius: 6px; background: #3DDC84; color: #06210F; font: 800 .72rem/1 inherit; }
.fp-joy { display: none; pointer-events: auto; position: absolute; left: 22px; bottom: 96px; width: 116px; height: 116px; border-radius: 50%; background: rgba(17, 23, 32, .45); border: 1px solid rgba(255, 255, 255, .13); touch-action: none; }
.fp-joy i { position: absolute; left: 50%; top: 50%; width: 48px; height: 48px; margin: -24px 0 0 -24px; border-radius: 50%; background: var(--o-accent, #EF8A5F); opacity: .9; }
.is-fp .team-tag { display: none; }
.is-fp .zone { display: none; }
@media (max-width: 520px) { .tb-fp span:last-child { display: none; } .tb-fp { padding: 0 11px; } .fp-help { top: 56px; max-width: calc(100% - 24px); } }
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
.pb-exit { display: inline-grid; place-items: center; padding: 7px; }
.pb-tgl:focus-visible, .pb-seg button:focus-visible, .pb-shoot:focus-visible, .pb-exit:focus-visible { outline: 2px solid #F2B33D; outline-offset: 2px; }
@media (max-width: 720px) { .photo-hint { display: none; } .pb-sep { display: none; } }
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

/** Builds the bar's, the walk's overlay's and the photo bar's markup and styles, before the modules that fill and wire them. */
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
    if (fp.on) exitFp();
    if (state.selectedId) closeSession();
    goView(b.dataset.view);
  });
  $('zoom-in').addEventListener('click', () => {
    if (fp.on) { fpCam.fov = Math.max(40, fpCam.fov - 8); fpCam.updateProjectionMatrix(); return; }
    setView(null); state.zoomGoal = Math.min(controls.maxZoom, (state.zoomGoal ?? camera.zoom) * 1.2);
  });
  $('zoom-out').addEventListener('click', () => {
    if (fp.on) { fpCam.fov = Math.min(90, fpCam.fov + 8); fpCam.updateProjectionMatrix(); return; }
    setView(null); state.zoomGoal = Math.max(controls.minZoom, (state.zoomGoal ?? camera.zoom) / 1.2);
  });
  if (!document.fullscreenEnabled) $('btn-full').hidden = true;
  $('btn-full').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => host.toast("This browser won't go full screen."));
  });
  document.addEventListener('fullscreenchange', () => $('btn-full').setAttribute('aria-pressed', String(!!document.fullscreenElement)));
  // (while walking, the percent is the field of view's zoom over the start's 70)
  setInterval(() => { const v = `${Math.round((fp.on ? 70 / fpCam.fov : camera.zoom / (fitZoom || 1)) * 100)}%`, z = $('zoom-val'); if (z.textContent !== v) z.textContent = v; }, 200);   // (written only when it changes: a write costs a style pass)
  // (made after the renderer's own observer, so the frustum already has the frame's new shape)
  new ResizeObserver(() => { if (home && !state.selectedId) fitFloor(); }).observe(document.getElementById('stage'));
  // Walk in needs keys: shown for a fine pointer only (a phone could only look around)
  const fine = matchMedia('(pointer: fine)');
  const showWalk = () => { $('btn-fp').hidden = !fine.matches; };
  showWalk(); fine.addEventListener('change', showWalk);
  // upstream leaves walk-in from ui/topbar.js, which is not taken: the place card goes first, as there
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !fp.on) return;
    const card = $('plc');
    if (card && !card.hidden) return;
    exitFp();
  });
}
