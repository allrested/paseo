// PASEO: who gets up from a rest, when, and for what: the decisions of the lively floor, with nothing of the scene in
// them, so a test runs them without a browser (plugins/office/client/world/leisure.test.ts). paseo-leisure.js asks
// here once a second and moves the people.
export const LEISURE = {
  dayFrom: 8, dayTo: 21,        // the hours an activity may start in, by the clock the scene reads
  gap: [30, 90],                // seconds at the desk between two activities
  longRest: 2 * 3600,           // after this many seconds of rest…
  longGap: [600, 1200],         // …the gap is this long
  nap: [180, 360], arcade: [60, 180], cup: [120, 240],   // how long each lasts, seconds
};
/** The games two play: they need a second agent at rest. */
export const PAIR = ['pool', 'foosball', 'tv'];
export const KINDS = [...PAIR, 'karaoke', 'nap', 'fish', 'arcade', 'cup', 'wc'];
export const daytime = (hour) => hour >= LEISURE.dayFrom && hour < LEISURE.dayTo;
/** Work came in: a prompt, a question for the user, something left running. `s` is the session, `w` its person. */
export const called = (s, w) => !s || s.status !== 'rest' || !!s.bg?.length || !!w.want;

/**
 * The schedule. step() is asked with the time (`now`: the scene's seconds, for the gaps; `wall`: the clock's
 * milliseconds, for how long someone has rested), the hour, whether the floor is `quiet` (a gathering, reduced motion),
 * everyone (`agents`: { id, resting, idle }, idle meaning asleep at the desk) and what is possible (`open`: a flag per
 * kind). It answers { id, kind } for the one whose gap is over, or null. The caller says how it went: started(ids, kind)
 * with whoever went (a game picks its own players), or declined(id, now, wall).
 */
export function createPlan(random = Math.random) {
  const seen = new Map();   // id -> { idle, nextAt, last, restFrom }
  const between = ([a, b]) => a + random() * (b - a);
  const gapOf = (st, wall) => between(wall - st.restFrom >= LEISURE.longRest * 1000 ? LEISURE.longGap : LEISURE.gap);
  return {
    step({ now, wall, hour, quiet, agents, open }) {
      const here = new Set(agents.map((a) => a.id));
      for (const id of [...seen.keys()]) if (!here.has(id)) seen.delete(id);   // (left the office)
      let due = null, idle = 0;
      for (const a of agents) {
        let st = seen.get(a.id);
        if (!st) { st = { idle: false, nextAt: 0, last: null, restFrom: null }; seen.set(a.id, st); }
        if (!a.resting) { st.idle = false; st.restFrom = null; continue; }
        st.restFrom ??= wall;
        if (a.idle && !st.idle) st.nextAt = now + gapOf(st, wall);   // back at the desk: a new gap
        st.idle = a.idle;
        if (!a.idle) continue;
        idle += 1;
        if (now >= st.nextAt && (!due || st.nextAt < due.st.nextAt)) due = { id: a.id, st };
      }
      if (!due) return null;
      const can = quiet || !daytime(hour) ? [] : KINDS.filter((k) => open[k] && k !== due.st.last && (idle > 1 || !PAIR.includes(k)));
      if (!can.length) { due.st.nextAt = now + gapOf(due.st, wall); return null; }   // (nothing to do now: at the next gap)
      return { id: due.id, kind: can[Math.floor(random() * can.length)] };
    },
    started(ids, kind) { for (const id of ids) { const st = seen.get(id); if (st) { st.last = kind; st.idle = false; } } },
    declined(id, now, wall) { const st = seen.get(id); if (st) st.nextAt = now + gapOf(st, wall); },
    /** What is known of someone: { idle, nextAt, last, restFrom }, or undefined. */
    of: (id) => seen.get(id),
  };
}
