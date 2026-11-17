// PASEO: the entry of the page the office is drawn in. It stands where upstream's main.js,
// net/live.js's connection and life/incidents.js's event handler stand: it builds the world from
// the kept modules, in upstream's order, and gives Paseo's office plugin one object to drive it.
// The plugin's side of this contract is plugins/office/client/world/world-api.ts.
import { state } from './core/state.js';
import { MODULES } from './paseo-modules.js';
import { host } from './paseo-host.js';
import { STYLE } from './paseo-style.js';
import { CSS2DObject } from '../../three/addons/renderers/CSS2DRenderer.js';
import { el, reduceMotion, short } from './core/env.js';
import { renderer, scene } from './scene/renderer.js';
import { canvasTex } from './scene/blocks.js';
import { focusTarget } from './core/loop.js';
import * as live from './net/live.js';
import * as whiteboard from './ui/whiteboard.js';
import * as backdrops from './world/backdrops/index.js';
import * as cameraBar from './ui/camera-bar.js';
import { ACT, bubbleText } from './ui/event-text.js';
import { TYPE_ICON, icon } from './ui/icons.js';
import { closeSession, openSession } from './ui/session-drawer.js';
import { setMacSnap } from './ui/mac-drawer.js';
import { PLACES } from './interact/place-chips.js';
import { PROPS } from './interact/props.js';
import { closePlace } from './interact/place-cards.js';
import { OFFICE_MARK, PRO_FX } from './world/pro/pieces.js';
import { SIGN, drawSign } from './paseo-sign.js';
import { followHostFocus } from './paseo-focus.js';
import { ringWithEveryone, updateLeisure } from './paseo-leisure.js';
import { everyFrame } from './life/nap.js';
import { dropSub, sessions, spawnSub, subAct, subs, workers } from './people/workers.js';
import { director } from './people/director.js';
import { STATIONS } from './people/navigation.js';
import { applaud, ringBell } from './people/gatherings.js';
import { launchRocket } from './world/room-update.js';
import { printPage } from './world/props/printer.js';
import { lostObj, syncDevBoxes } from './world/props/dev-servers.js';
import { shredAction } from './world/props/shredder.js';
import { clearRun, onTest } from './life/tests.js';
import { onTurnDone } from './life/your-turn.js';
import * as lifeIncidents from './life/incidents.js';
import * as audioSfx from './audio/sfx.js';
import { t as tr } from '../i18n/index.js';

const VERSION = 1;
let started = false;
let seated = false;
let limits = [];
let boardRows = [];
let problem = () => {};
let onMachine = null;
let stopped = false;

/** What upstream's page markup gives the kept modules: the stage, the place card, two controls. */
function buildPage() {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.append(style);
  document.documentElement.lang = 'en';
  document.body.innerHTML = `
    <div id="stage-wrap"><div id="stage"></div>
      <section class="plc" id="plc" hidden role="dialog" aria-labelledby="plc-title">
        <header class="plc-head"><span class="plc-ico" id="plc-ico"></span><div class="plc-title"><h3 id="plc-title"></h3><p id="plc-sub"></p></div>
          <button type="button" class="icon-btn" id="plc-close" aria-label="Close"><span data-icon="x"></span></button></header>
        <div class="plc-body" id="plc-body"></div><footer class="plc-foot" id="plc-foot" hidden></footer>
      </section>
    </div>
    <span id="conn" hidden><i></i><span></span></span><button type="button" id="btn-night" hidden></button>`;
}

/** The app theme, as the custom properties paseo-style.js reads and the page's colour scheme. */
function applyColors(colors, dark) {
  const root = document.documentElement.style;
  root.colorScheme = dark ? 'dark' : 'light';
  const set = (name, value) => { if (typeof value === 'string' && value) root.setProperty(name, value); };
  set('--o-surface-raised', colors.surface1);
  set('--o-surface', colors.surface2);
  set('--o-border', colors.border);
  set('--o-fg', colors.foreground);
  set('--o-muted', colors.foregroundMuted);
  set('--o-accent', colors.accent);
  set('--o-success', colors.statusSuccess);
  set('--o-warning', colors.statusWarning);
  set('--o-danger', colors.statusDanger);
  if (typeof colors.surface0 === 'string' && colors.surface0) host.surface = colors.surface0;
}

/** The project a team chip stands for: the first field of the key net/live.js keeps on it. */
const teamOf = (tag) => tag.key.split('|').slice(0, -3).join('|');

/** A team's chip opens that team's board in Paseo: a button, by pointer and by keyboard. */
/** A label of the scene that opens something: a button for the keyboard too (upstream's own click stays). */
function asButton(chip, open) {
  chip.setAttribute('role', 'button');
  chip.tabIndex = 0;
  chip.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    if (!event.repeat) open();
  });
}
function makeTeamChipsButtons() {
  for (const tag of live.teamTags || []) {
    const open = () => { const team = teamOf(tag); if (team) host.board(team); };
    tag.o.element.addEventListener('click', open);
    asButton(tag.o.element, open);
  }
}
/**
 * Paseo's own: a label over the meeting room's screen opens Paseo's stand-up notes, as a team's chip opens its board.
 * Upstream's slide on the screen stays as it is drawn. Only the company floor has the screen.
 * The label stands on the screen's top edge: at the screen's middle it sat under the meeting room's chip, which shows
 * on top of it while the room is pointed at or its card is open.
 */
function makeNotesLabel() {
  const label = el('div', 'team-tag');
  label.append(el('span', null, tr('paseo.notes')));
  const open = () => host.notes?.();
  label.addEventListener('click', open);
  asButton(label, open);
  const o = new CSS2DObject(label);
  o.position.set(0.2, 2.525, -7.95);
  o.center.set(0.5, 1);
  scene.add(o);
}
/** Paseo's banner over the stage: upstream's `#incident`, a button here, because a click on it opens Paseo's Incidents card. */
function makeIncidentBanner(open) {
  const banner = el('button', 'incident');
  banner.type = 'button';
  banner.id = 'incident';
  banner.hidden = true;
  banner.addEventListener('click', open);
  document.getElementById('stage-wrap').append(banner);
}
/** The banner names the newest open incident and how many more are open; with none open it hides. */
function showIncidents(open) {
  const banner = document.getElementById('incident');
  banner.hidden = open.length === 0;
  if (open.length === 0) return;
  const newest = open[0];
  banner.replaceChildren(el('span', 'incident-text', tr('incident.banner', { key: newest.key, title: newest.title })));
  if (open.length > 1) banner.append(el('span', null, ` · ${tr('incident.more', { n: open.length - 1 })}`));
}
/**
 * The server room's chip, the racks, the dev boxes, and the wall screen without Resources open Paseo's panel: no
 * reading, no panel, and the wall screen is furniture then too (ui/whiteboard.js).
 */
function showMachine(on) {
  host.machine = on && onMachine ? () => onMachine() : null;
  document.querySelector('.zone[data-place="server"]')?.toggleAttribute('hidden', !host.machine);
}

/** Upstream's mark on the sign, as world/pro/floor.js draws it: the sign of a host without a logo. */
function drawMark(g) {
  g.save();
  g.translate(150, SIGN.height / 2);
  g.scale(6.2, 6.2);
  g.translate(-12, -12);
  g.fillStyle = '#E8865F';
  g.fill(new Path2D(OFFICE_MARK), 'evenodd');
  g.restore();
}
/**
 * The lobby's sign and the reception's plaque share one material (upstream's PRO_FX.logoM): its picture is drawn again
 * with the host's brand. The name shows at once over the scene's mark; the logo takes the mark's place when it has
 * loaded, and one that does not load leaves the mark. The one-room floor has no lobby and no sign.
 */
function showBrand(brand) {
  const material = PRO_FX.logoM;
  if (!material || !brand || typeof brand.name !== 'string' || !brand.name) return;
  const paint = (logo) => {
    if (stopped) return;
    const old = material.map;
    material.map = canvasTex(SIGN.width, SIGN.height, (g, w, h) => drawSign(g, w, h, { name: brand.name, logo, mark: drawMark }));
    material.needsUpdate = true;
    old?.dispose();
  };
  paint(null);
  if (typeof brand.logoUrl !== 'string' || !brand.logoUrl) return;
  const image = new Image();
  image.onload = () => paint(image);
  image.src = brand.logoUrl;
}

/** What the place cards and the wall screen count an event as. */
const COUNTED = { prompt: 'prompts', read: 'read', grep: 'read', skill: 'read', web: 'web', mcp: 'web', edit: 'edit', write: 'edit', bash: 'cmd', test: 'cmd', commit: 'cmd', push: 'cmd', deploy: 'deploy' };
const FEED_MAX = 300;

/** Upstream's server keeps the feed and the counts; here they start when the office is opened. */
function record(e) {
  const s = sessions.get(e.sess);
  if (s) { s.last = e; s.lastAt = e.ts; }
  state.feed.push(e);
  if (state.feed.length > FEED_MAX) state.feed.splice(0, state.feed.length - FEED_MAX);
  const counted = COUNTED[e.type];
  if (counted) state.stats[counted] = (state.stats[counted] || 0) + 1;
}

const clockTime = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * Paseo's own: someone whose turn has ended waits on the agents they started (the session's `waitingOn` says how many).
 * To the desk, thinking, with that in the bubble. It is no step and no prompt: nothing goes to the feed or the counts,
 * and the director carries nothing over.
 */
function waitOnSubs(id) {
  const w = workers.get(id), n = sessions.get(id)?.waitingOn || 1;
  if (w) w.push({ station: 'desk', anim: 'think', type: 'agent', text: tr('paseo.subwait', { n }), dwell: 2 });
}

/** Upstream's life/incidents.js onEvent, the part that moves people and furniture. */
function onEvent(e) {
  record(e);
  const s = sessions.get(e.sess), w = workers.get(e.sess);
  if (e.type === 'stop' || e.type === 'commit') printPage();   // every finished turn and every commit prints a page
  if (e.type === 'test' || e.type === 'testok' || e.type === 'testfail') onTest(e);
  if (e.type === 'deploy' && w) w.cheeredAt = null;   // (upstream's applaud cheers someone once per 600 s: a deploy is cheered also right after a push)
  if (e.type === 'push' || e.type === 'deploy') applaud(e.sess);
  if (e.type === 'deploy') launchRocket();   // (a deploy that succeeded; a push is applauded and no more)
  if (e.type === 'stop' && s) onTurnDone(s);
  if (!w || !s) return;
  if (e.type === 'substart') { spawnSub(w, e.agent, e.label); return; }
  if (e.type === 'substop') { const sw = subs.get(e.agent); if (sw && e.desc) sw.desc = e.desc; dropSub(e.agent); return; }
  if (e.agent) {
    const sw = subs.get(e.agent) || spawnSub(w, e.agent, e.agentType || 'agent');
    if (e.desc) sw.desc = e.desc;
    sw.push(subAct(e));
    if (sw.phase === 'walk' || sw.station === (ACT[e.type]?.station || 'desk')) { sw.say(e.type, bubbleText(e), e.type === 'fail' ? 'fail' : ''); sw.lastSay.e = e; }
    return;
  }
  if (e.type === 'start' || e.type === 'end') return;
  const said = e.type === 'fail' && e.of === 'deploy' ? tr('paseo.deploy.failed') : bubbleText(e);
  let a = { ...(ACT[e.type] || ACT.other), type: ACT[e.type] ? e.type : 'other', text: said, e };
  if (e.type === 'fail') {   // a second failure within two minutes: frustration, a fist on the desk
    w.fails = (w.fails || []).filter((t) => state.sim - t < 120); w.fails.push(state.sim);
    if (w.fails.length >= 2 && !reduceMotion) { a = { ...a, anim: 'slam', text: tr('incident.againFail', { text: said }), dwell: 2.2 }; w.slamUntil = state.sim + 2.2; }
  }
  if (e.type === 'prompt') a.after = () => { state.boardPulse = { id: e.sess, until: state.sim + 2.6 }; state.boardDirty = true; };
  if (director && e.type === 'prompt') director.deliver(e.sess, e.label || '');
  if (director && e.type === 'stop' && director.station === 'home' && STATIONS.director.some((x) => !x.by)) {   // the company floor: report to the director first, then rest
    const rest = a, done = s.lastPrompt || e.label || '';
    a = { station: 'director', anim: 'think', type: 'stop', text: !done ? tr('incident.reportNoTask') : tr('incident.report', { task: short(done, 40) }), e, dwell: 2.4,
      after: () => { if (!director.ack(w)) w.say('stop', tr('incident.reportLeft')); w.push(rest); } };
  }
  w.push(e.type === 'compact' ? shredAction(w, a) : a);
}

const api = {
  version: VERSION,
  /**
   * Builds the office. `options`: plan ('pro' | 'cozy'), dark, colors (the app theme), brand
   * ({ name, logoUrl }, for the lobby's sign), and what
   * the scene tells Paseo: onSelect(id | null), onBoard(project | null) (a team's chip, or the
   * whiteboard), onProblem(message), and, when Paseo has something to show for them, onMachine()
   * (the server racks), onResources() (the server room's wall screen), onLibrary() (the library's
   * chip and the bookshelf), onBell() (a click on the meeting table's bell), onNotes() (the label over
   * the meeting room's screen, on the company floor), onOpen(id) (E by a person while walking: their
   * session), onIncidents() (the incidents' banner) and onToast(text).
   * Throws when the world cannot be built (no WebGL, a module failed).
   */
  start(options = {}) {
    if (started) return;
    started = true;
    host.plan = options.plan === 'cozy' ? 'cozy' : 'pro';
    host.night = options.dark === true;
    host.select = (id) => options.onSelect?.(id);
    host.board = (project) => options.onBoard?.(typeof project === 'string' ? project : null);
    onMachine = typeof options.onMachine === 'function' ? options.onMachine : null;
    host.machine = null;
    host.toast = (text) => options.onToast?.(text);
    host.library = typeof options.onLibrary === 'function' ? () => options.onLibrary() : null;
    host.resources = typeof options.onResources === 'function' ? () => options.onResources() : null;
    host.bell = typeof options.onBell === 'function' ? () => options.onBell() : null;
    host.notes = typeof options.onNotes === 'function' ? () => options.onNotes() : null;
    host.open = typeof options.onOpen === 'function' ? (id) => options.onOpen(id) : null;
    host.limits = () => limits;
    host.boardRows = () => boardRows;
    problem = (message) => options.onProblem?.(message);
    buildPage();
    cameraBar.build();
    // (the frame counts as focused while Paseo's page is: upstream's loop draws full rate then, see paseo-focus.js)
    followHostFocus(document, window.parent);
    applyColors(options.colors || {}, host.night);
    // what upstream's first message from its server sets
    state.stats = {}; state.todos = []; state.feed = []; state.limits = null; state.world = true;
    for (const [name, module] of MODULES) {
      // (upstream starts its incidents and its sounds after the live connection; Paseo's trimmed copies are not in MODULES)
      if (name === 'coreLoop') { lifeIncidents.setup(); audioSfx.setup(); }
      if (name === 'coreLoop') backdrops.setup();   // (upstream sets the backdrop up just before the loop)
      if (typeof module.setup === 'function') module.setup();
      if (name === 'interactPlaceCards') whiteboard.setup();
      if (name === 'netLive') { live.setupTeams(); makeTeamChipsButtons(); }
    }
    // Upstream's streamer mode says "a file" and "a command" where it would show a name. Paseo sends no names, so it is
    // always on (set here, after ui/event-text.js read upstream's own setting).
    state.streamer = true;
    // (upstream gives a compaction its sparkle; what the person carries to the shredder is paper)
    TYPE_ICON.compact = 'file';
    cameraBar.setup();
    // Escape closes the place card and gives the keyboard back to the chip that opened it.
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || document.getElementById('plc').hidden || document.body.classList.contains('is-photo')) return;
      const chip = document.querySelector('.zone--open');
      closePlace();
      chip?.focus({ preventScroll: true });
    });
    // (a place with an `open` has no card of upstream's: the whiteboard's chip opens Paseo's board)
    if (PLACES?.board) PLACES.board.open = () => host.board();
    // (the library's chip and the bookshelf open Paseo's Library card, which has the skills; upstream's card there
    // lists what was read since the office opened)
    if (PLACES?.library && host.library) PLACES.library.open = () => host.library();
    // (upstream marks the lounge with its sparkle; the cup that marks who rests there says what the place is for)
    for (const place of Object.values(PLACES || {})) if (place.icon === 'sparkle') place.el?.querySelector('.z-ico')?.replaceChildren(icon('coffee'));
    // (the bell on the meeting table: whoever is at a solo activity stops for it, as for the stand-up card's bell; a click
    // on it also tells Paseo, which has the day's stand-up notes written. meet() rings without it.)
    const bell = PROPS.get('bell');
    if (bell) { const ring = bell.act; bell.act = () => { ringWithEveryone(ring); host.bell?.(); }; }
    if (host.plan === 'pro' && host.notes) makeNotesLabel();
    makeIncidentBanner(() => options.onIncidents?.());
    // (the wall screen opens Paseo's Resources when Paseo has it, and its tooltip says so; the racks and the server
    // room's chip keep the panel)
    const tv = PROPS.get('tv');
    if (tv && host.resources) { tv.act = () => host.resources(); tv.hint = tr('paseo.tv.resources'); }
    everyFrame(updateLeisure);
    showMachine(false);
    showBrand(options.brand);
    host.brandName = options.brand?.name || '';
    // (the tag over the boxes left behind opens the panel; upstream listens for its click already)
    if (lostObj) asButton(lostObj.element, () => host.machine?.());
    renderer.domElement.addEventListener('webglcontextlost', () => { if (!stopped) problem('the graphics context was lost'); });
    renderer.domElement.setAttribute('aria-hidden', 'true');
    let reported = false;
    window.addEventListener('error', (event) => { if (reported || stopped) return; reported = true; problem(String(event.message || 'the office stopped drawing')); });
  },
  /** The page is about to be thrown away: give the graphics context back now, not at the next collection. */
  stop() {
    if (!started || stopped) return;
    stopped = true;
    renderer.dispose();
    renderer.forceContextLoss();
  },
  /** The app's theme changed. */
  setTheme({ dark, colors } = {}) {
    if (!started) return;
    host.night = dark === true;
    applyColors(colors || {}, host.night);
    backdrops.applyNight(host.night);
  },
  /**
   * Everyone in the office now, in upstream's session shape: { id, name, title, dir, git: { repo },
   * status: 'work' | 'wait' | 'rest', agent, lastPrompt, doneAt, last, stuck, subs, usage: { ctx, ctxMax } }.
   * The first list is seated at once; later a newcomer walks in from the lift and someone who is
   * gone walks out. `usage` is the context window in tokens: the paper on the desk and in its bin.
   * `doneAt` is when someone resting came to rest (ms). The last event the scene saw of a person stays, and its time
   * unless they are stopped on an error: such a person stays at the desk at night, the red tag in sight.
   */
  setSessions(list) {
    if (!started) return;
    const ids = new Set(list.map((s) => s.id));
    for (const id of [...sessions.keys()]) if (!ids.has(id)) live.removeSession(id);
    for (const s of list) {
      const was = sessions.get(s.id);   // (record() keeps the last event on the session object this one replaces)
      if (was) { s.last ??= was.last; if (!s.stuck) s.lastAt ??= was.lastAt; }   // (stopped on an error: no time, so no walk home at night)
      live.upsertSession(s, seated);
    }
    seated = true;
    state.connectedOnce = true;
    state.boardDirty = true;
  },
  /**
   * Something a session did: { sess, type }, `type` a key of upstream's ACT table. No text comes with it. A `deploy` is
   * a deploy that succeeded; a `fail` with `of: 'deploy'` is one that failed.
   */
  event(e) {
    if (!started || !e || !sessions.has(e.sess)) return;
    if (e.type === 'testend') { clearRun(e.sess); return; }
    if (e.type === 'subwait') { waitOnSubs(e.sess); return; }
    // the test board writes a run's label beside its result: Paseo gives the time it ended
    const ended = e.type === 'testok' || e.type === 'testfail';
    onEvent({ ts: Date.now(), sess: e.sess, type: e.type, label: ended ? clockTime() : '', of: e.of });
  },
  /** Paseo chose someone (its card opened) or nobody (it closed): mark them, tell nobody back. */
  select(id) { if (!started) return; if (id && sessions.has(id)) openSession(id, { tell: false }); else closeSession({ tell: false }); },
  /** Glide to a project's desks without choosing anyone. */
  focusProject(project) {
    if (!started || !focusTarget) return;
    const first = [...sessions.values()].find((s) => live.projOf(s) === project);
    const w = first ? workers.get(first.id) : null;
    if (w) focusTarget.set(w.pos.x, 0.6, w.pos.y);
  },
  /** The whiteboard's rows: [{ id, name, color, text, state: 'doing' | 'wait' | 'done' }]. */
  setBoardRows(rows) { boardRows = Array.isArray(rows) ? rows : []; state.boardDirty = true; },
  /** The host's readings, for the server racks and the wall screen; null when unknown. */
  setMachine(snapshot) {
    if (!started) return;
    setMacSnap(snapshot || null);
    showMachine(!!snapshot);
    syncDevBoxes(snapshot || null);
  },
  /**
   * A stand-up: upstream's meeting bell, with a stand-up's opening line. Everyone free walks to the meeting table and
   * says what they are on; whoever is at a solo activity of the lively floor stops for it, and a game is played out.
   * Upstream says in a toast when nobody is free; Paseo's stand-up card is open then and says who is at work, so that
   * toast is not passed on.
   */
  meet() {
    if (!started || stopped) return;
    const toast = host.toast;
    host.toast = () => {};
    try { ringWithEveryone(() => ringBell(tr('people.meet.standup'))); } finally { host.toast = toast; }
  },
  /**
   * The open incidents, newest first: [{ id, key, title, ring }]. The banner shows while any is open. One that rings
   * (this device has not rung for it) starts upstream's alarm: 25 s of red, a fail bubble over everyone at work and the
   * siren. Several that ring at once ring once.
   */
  setIncidents(list) {
    if (!started || stopped) return;
    const open = Array.isArray(list) ? list : [];
    showIncidents(open);
    if (open.some((incident) => incident.ring)) lifeIncidents.startIncident();
    // With every incident dismissed, the red ends at the next frame rather than after its 25 s.
    if (open.length === 0) state.incidentUntil = 0;
  },
  /** Usage windows of the accounts in use: [{ key, pct, resetsAt }]. */
  setLimits(list) { limits = Array.isArray(list) ? list : []; },
};

globalThis.PaseoOfficeWorld = api;
