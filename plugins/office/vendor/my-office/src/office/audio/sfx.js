// Sounds, synthesized in the browser.
// PASEO: upstream's file, trimmed to its engine and the siren, which the incidents alarm plays (life/incidents.js).
// Every other name a module plays makes no sound.
import { reduceMotion, replay } from '../core/env.js';

export let sfx;

export function setup() {
  /* ---------- sounds: synthesized in the browser (no files), each kind rate-limited, muted with one switch ---------- */
  sfx = (() => {
    let ctx = null, on = true;
    try { on = localStorage.getItem('office-sound') !== 'off'; } catch { /* storage blocked */ }
    const last = new Map();
    const unlock = () => { if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* no audio */ } } if (ctx?.state === 'suspended') ctx.resume(); };
    addEventListener('pointerdown', unlock, { passive: true }); addEventListener('keydown', unlock);
    const tone = (f, t0, dur, type = 'sine', vol = 0.15, f2 = null) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t0); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(ctx.destination); o.start(t0); o.stop(t0 + dur + 0.02);
    };
    // PASEO: the siren alone; `noise` and the other sounds are not taken
    const SOUNDS = {
      siren: (t) => { for (let i = 0; i < 3; i++) { tone(620, t + i * 0.6, 0.3, 'square', 0.05, 880); tone(880, t + i * 0.6 + 0.3, 0.3, 'square', 0.05, 620); } },
    };
    // PASEO: the siren's gap alone
    const GAP = { siren: 4 };
    return {
      // PASEO: off to the modules that ask: people/karaoke.js sings through its own audio while this is on, and Paseo
      // takes the siren alone. The siren still follows the switch.
      get on() { return false; },
      set(v) { on = v; try { localStorage.setItem('office-sound', v ? 'on' : 'off'); } catch { /* storage blocked */ } if (v) unlock(); },
      play(name) {
        if (!on || replay.on || !ctx || ctx.state !== 'running' || reduceMotion && name === 'key') return;
        const now = ctx.currentTime; if (now - (last.get(name) ?? -9) < (GAP[name] || 0.2)) return;
        last.set(name, now); SOUNDS[name]?.(now + 0.01);
      },
    };
  })();
}
