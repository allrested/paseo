// PASEO: stand-in for my-office's life/nap.js, which Paseo does not take: its midday nap would put the whole floor to
// sleep. The scene's loop calls updateNap every frame; Paseo's lively floor (paseo-leisure.js) runs from it, set here by
// paseo-entry.js so that this file imports nothing.
export const napOn = false;
let frame = null;
export function everyFrame(fn) { frame = fn; }
export function updateNap(dt) { frame?.(dt); }
