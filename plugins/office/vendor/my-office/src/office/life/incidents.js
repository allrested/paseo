// PASEO: Incidents: one the office found in Jira or Sentry turns the office red (upstream's: repeated failures).
// PASEO: upstream's file, trimmed. An incident is one Paseo's office found in a tracker and the entry tells the scene
// (paseo-entry.js setIncidents), not three failures in five minutes: `fails` and that branch are cut. `onEvent` is cut
// too: its part that moves people and furniture is paseo-entry.js's. The banner is paseo-entry.js's: it shows while an
// incident is open, not only while the office is red. `three` is imported by path, as in every copied file.
import * as THREE from '../../../three/three.module.min.js';
import { state } from '../core/state.js';
import { $, reduceMotion } from '../core/env.js';
import { ACT } from '../ui/event-text.js';
import { scene } from '../scene/renderer.js';
import { sessions, workers } from '../people/workers.js';
import { sfx } from '../audio/sfx.js';
import { t as tr } from '../../i18n/index.js';

// PASEO: incidents: a new one from a tracker turns the office red for 25 s (upstream's: three failures in five minutes)
const alarm = new THREE.PointLight('#FF2A2A', 0, 18, 1.4);
// PASEO: exported for paseo-entry.js; no session to name and no banner to fill here, the banner is the entry's
export function startIncident() {
  state.incidentUntil = state.sim + 25; $('stage-wrap').classList.add('is-incident'); sfx.play('siren');
  for (const w of workers.values()) if (sessions.get(w.id)?.status === 'work') w.push({ ...ACT.fail, type: 'fail', text: tr('incident.bubble') });
  // PASEO: no headache(): the errand for headache pills (people/outings.js) is not taken
}
export function updateIncident(t) {
  const on = state.sim < state.incidentUntil;
  alarm.intensity = on ? (0.5 + 0.5 * Math.sin(t * 9)) * 22 : 0;
  // PASEO: a steady red under reduced motion
  if (on && reduceMotion) alarm.intensity = 14;
  // PASEO: the red ends after its 25 s; the banner is left to paseo-entry.js
  if (!on && $('stage-wrap').classList.contains('is-incident')) $('stage-wrap').classList.remove('is-incident');
}

export function setup() {
  state.incidentUntil = 0;
   alarm.position.set(0, 3.6, 0);
   scene.add(alarm);
}
