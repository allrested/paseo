import type { Incident } from "../../shared/contracts.js";

/**
 * How long a device remembers ringing for an incident. The host closes an incident within a day,
 * so an id is gone from the open list well before the device forgets it.
 */
const RUNG_FOR_MS = 2 * 24 * 60 * 60 * 1000;

/** The ids of the open incidents this device has not rung for, in the order given. */
export function toRing(open: Incident[], rung: Record<string, number>): string[] {
  const fresh = open.filter((incident) => !Object.hasOwn(rung, incident.id));
  return fresh.map((incident) => incident.id);
}

/** The device's rung map with `ids` rung at `now`, less what it rang for over 2 days ago. */
export function markRung(
  rung: Record<string, number>,
  ids: string[],
  now: number,
): Record<string, number> {
  const recent = Object.entries(rung).filter(([, at]) => now - at <= RUNG_FOR_MS);
  const next = Object.fromEntries(recent);
  for (const id of ids) next[id] = now;
  return next;
}
