// PASEO: stand-in for my-office's ui/mac-drawer.js (its machine panel). The scene reads the
// machine's memory and the plan's usage from here; Paseo sets them (see paseo-entry.js).
import { host } from '../paseo-host.js';

/** The host's readings, in upstream's shape: { mem: { used, total }, cpu: { percent }, servers: [] }. */
export let macSnap = null;
export function setMacSnap(snapshot) { macSnap = snapshot; }
export const liveWindows = () => host.limits();
export function openMac() { host.machine?.(); }
/** When a limit resets, as a clock time: "21:10". */
export function resetText(at) {
  const date = new Date(at);
  return Number.isFinite(date.getTime()) ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
}
