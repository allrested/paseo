// PASEO: the lively floor. An agent at rest does not sleep the day away at its desk: after a gap it gets up for a game
// (upstream's pool, foosball, TV match and karaoke, through their own starters), a nap on the sofa, the fish, the arcade,
// a cup in the dining room or the restroom, with upstream's own moves (errand(), visitWc(), feedFish(), brewCoffee()).
// paseo-leisure-plan.js decides who, when and what; this file moves the people. The stand-in of life/nap.js calls
// updateLeisure every frame, once paseo-entry.js has set it there.
import { state } from './core/state.js';
import { PRO, nowMs, officeNow, rand, reduceMotion, replay } from './core/env.js';
import { AQ } from './world/props/aquarium.js';
import { ARC } from './world/props/arcade.js';
import { STEAM_AT } from './world/furniture/coffee.js';
import { brewCoffee, feedFish } from './interact/props.js';
import { STATIONS, standBy, wayTo } from './people/navigation.js';
import { COFFEE_Q } from './people/breaks.js';
import { sessions, workers } from './people/workers.js';
import { asleep, quip } from './people/errands.js';
import { gatheringNow } from './people/gatherings.js';
import { bilState, billiards } from './people/billiards.js';
import { foosState, foosball } from './people/foosball.js';
import { tvMatch, tvState } from './people/gaming.js';
import { karaoke, ktvState } from './people/karaoke.js';
import { t as tr } from '../i18n/index.js';
import { LEISURE, called, createPlan } from './paseo-leisure-plan.js';

const plan = createPlan();
const solo = new Map();   // session id -> { w, kind, e (the errand; null in the restroom), seat (the cup's chair), sat }
let lookAt = 0;

// at rest, with nothing else on: as upstream's games choose their players (people/billiards.js who())
const resting = (w, s) => !w.sub && s?.status === 'rest' && !s.bg?.length && !w.want;
const idle = (w, s) => resting(w, s) && asleep(w) && w.station === 'desk' && !w.onBreak && !w.outing && !w.street && !w.carry && !w.doze && !w.mealBox && !w.shred;
const sofa = () => (PRO ? STATIONS.coffee.slice(0, 2) : []);   // (the TV's two seats: people/gaming.js)
const busy = (kind) => [...solo.values()].some((x) => x.kind === kind);
// where to stand at a thing: on its `front` side when there is room, from where they are or from the nearest aisle
const by = (w, at, front) => wayTo(w, at.x, at.z, front) || standBy(at.x, at.z, front) || wayTo(w, at.x, at.z) || standBy(at.x, at.z);

function openNow() {
  const seats = sofa(), tv = PRO ? tvState().stage : null;
  return {
    pool: PRO && !bilState().stage,
    foosball: PRO && !foosState(),
    tv: PRO && !tv && seats.length === 2 && seats.every((s) => !s.by),
    karaoke: PRO && !ktvState().stage,
    nap: !tv && seats.some((s) => !s.by),
    fish: !!AQ && !busy('fish'),
    arcade: !!ARC && !busy('arcade'),
    cup: !busy('cup') && !!COFFEE_Q?.[0] && !COFFEE_Q[0].by && !!STATIONS.dining?.some((s) => !s.by),
    wc: !!STATIONS.wc?.some((s) => !s.by),
  };
}

/** Off to something alone: upstream's errand, held for `secs` when it is more than a moment. */
function away(w, kind, job, secs = 0) {
  const e = w.errand({ type: 'idle', wait: 0.6, hold: 0.4, anim2: 'idle', linger: 0.8, ...job });
  if (secs) e.until = state.sim + secs;
  const x = { w, kind, e, seat: null, sat: false };
  solo.set(w.id, x);
  return x;
}
const SOLO = {
  nap(w) {
    const seat = sofa().find((s) => !s.by); if (!seat) return false;
    away(w, 'nap', { spot: seat, anim: 'sleep', line: tr('paseo.leisure.nap'), arrived: () => w.hush() }, rand(...LEISURE.nap));
    return true;
  },
  fish(w) {
    const spot = by(w, AQ); if (!spot) return false;
    away(w, 'fish', { spot, look: [AQ.x, AQ.z], anim: 'tidy', hold: 1.4, linger: 5, line: tr('paseo.leisure.fish'), arrived: () => feedFish() });
    return true;
  },
  arcade(w) {
    const spot = by(w, ARC, [0, 1]); if (!spot) return false;   // (its stick and buttons are on the +z side)
    away(w, 'arcade', { spot, look: [ARC.x, ARC.z], anim: 'console', line: tr('paseo.leisure.arcade'), arrived: () => { state.arcCoin = state.sim + 3; } }, rand(...LEISURE.arcade));
    return true;
  },
  // brewed at the machine, then drunk at a dining chair (the second leg starts in updateLeisure)
  cup(w) {
    const head = COFFEE_Q?.[0], seat = STATIONS.dining?.find((s) => !s.by); if (!head || head.by || !seat) return false;
    const x = away(w, 'cup', { spot: { x: head.x, z: head.z, face: head.face, node: head.node }, look: [STEAM_AT.x, STEAM_AT.z], anim: 'coffee', hold: 2.6, linger: 0.9,
      line: tr('paseo.leisure.cup'), arrived: () => brewCoffee() });
    x.seat = seat; seat.by = w;   // (kept while the cup brews)
    return true;
  },
  wc(w) {
    if (!STATIONS.wc?.some((s) => !s.by)) return false;
    w.anim = 'idle'; w.visitWc(); quip(w, tr('paseo.leisure.wc'));
    solo.set(w.id, { w, kind: 'wc', e: null, seat: null, sat: false });
    return true;
  },
};
// a game picks its own players among everyone at rest: who went is read from the game
const GAMES = {
  pool: () => billiards(true) && bilState().players,
  foosball: () => foosball(true) && foosState().players,
  tv: () => tvMatch(true) && tvState().players,
  karaoke: () => karaoke(true) && ktvState().singers,
};
/** One activity now (`kind` of the plan's KINDS), also for whoever tries the scene in a test page. Returns who went, or null. */
export function leisureNow(id, kind) {
  const w = workers.get(id), went = GAMES[kind] ? GAMES[kind]() || null : w && SOLO[kind]?.(w) ? [id] : null;
  if (went) plan.started(went, kind);
  return went;
}
function drop(id) {
  const x = solo.get(id); if (!x) return;
  if (x.seat && x.seat.by === x.w && x.w.spot !== x.seat) x.seat.by = null;
  solo.delete(id);
}

export function updateLeisure() {
  if (replay.on) return;
  for (const [id, x] of solo) {
    const w = x.w;
    if (workers.get(id) !== w || w.leaving || (x.e ? w.chore !== x.e : !w.wcBusy && !w.inStall)) { drop(id); continue; }   // done, taken into a game or a gathering, or gone
    if (x.kind === 'wc') {   // work: out of the stall or off the sink and to the desk at once (upstream's wcTick would finish first)
      if (called(sessions.get(id), w)) stop(id).goHomeAndRest();
      continue;
    }
    if (!x.e || x.e.stage === 'back') continue;
    if (called(sessions.get(id), w)) { w.after = null; w.anim = 'idle'; w.errandBack(); continue; }   // work: to the desk at once
    if (x.kind === 'cup' && !x.sat && x.e.stage === 'done') {   // the cup is ready: to the chair with it
      x.sat = true; w.after = null; w.hush();
      x.e = w.errand({ type: 'idle', spot: x.seat, anim: 'coffee', wait: 0, hold: 0.4, anim2: 'idle', linger: 0.8 });
      x.e.until = state.sim + rand(...LEISURE.cup);
    }
  }
  if (state.sim < lookAt) return;
  lookAt = state.sim + 1;
  const agents = [];
  for (const [id, w] of workers) { const s = sessions.get(id); agents.push({ id, resting: resting(w, s), idle: idle(w, s) }); }
  const next = plan.step({ now: state.sim, wall: nowMs(), hour: officeNow().getHours(), quiet: reduceMotion || !!gatheringNow(), agents, open: openNow() });
  if (!next) return;
  if (!leisureNow(next.id, next.kind)) plan.declined(next.id, state.sim, nowMs());
}

/** Someone at a solo activity stops where they stand: free for a gathering. */
function stop(id) {
  const w = solo.get(id).w, there = w.phase !== 'walk' && w.spot && Math.hypot(w.pos.x - w.spot.x, w.pos.y - w.spot.z) < 0.1;
  if (!there) { if (w.spot?.by === w) w.spot.by = null; w.spot = null; }
  w.after = null; w.chore = null; w.onArrive = null; w.path = []; w.phase = 'idle';
  w.inStall = null; w.wcBusy = false; w.pose = 'stand'; w.anim = 'idle'; w.station = 'leisure'; w.hush();
  w.root.visible = true; w.root.matrixWorldAutoUpdate = true;   // (out of a shut stall)
  drop(id);
  return w;
}
/**
 * Rings the bell (`ring`: upstream's ringBell, or the bell prop's own action) with everyone at a solo activity stopped
 * first, so the gathering takes them along; they go back to their desks after it. A player in a game finishes the game.
 */
export function ringWithEveryone(ring) {
  const freed = gatheringNow() ? [] : [...solo.keys()].filter((id) => !called(sessions.get(id), solo.get(id).w)).map(stop);   // (not who was called to work)
  const rung = ring();
  for (const w of freed) if (w.chore) w.chore.b.spot = null;
  return rung;
}
