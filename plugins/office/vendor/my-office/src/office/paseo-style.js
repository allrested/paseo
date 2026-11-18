// PASEO: the styles of the page the scene is drawn in: the stage, and the labels the scene puts
// over it (name tags, speech bubbles, place chips, the place card). Paseo's own, in its design
// language; the colours are the app theme's, set as custom properties by paseo-entry.js.
//
// Why each choice:
// - labels use the app's surface, border and text colours, so they read as part of Paseo in both
//   themes; the scene is the bright thing, the labels stay quiet;
// - a state is a small dot or a border in the theme's status colours, never a glow;
// - radii are 6 (chips), 8 (bubbles) and 12 (the card): one scale, nothing pill-shaped;
// - muted text sits on the raised surface only, where the app's own muted text sits: on the
//   second surface it falls under 4.5:1 in the light theme, so a tag's badge is set off by a
//   rule, not by a fill;
// - the font is the system stack react-native-web gives the plugin's own text;
// - the labels are one layer (the scene orders them by depth inside it), under the place card
//   and the tooltip;
// - nothing in a label moves by itself; the people do the moving;
// - a team's chip and a place's chip are buttons; the focus ring is in the text colour, because
//   the accent falls under 3:1 on the dark theme's surface; under a finger
//   they take touches 10 px past their edges (44 px in all) and keep their size, because a
//   bigger chip hides the desks it names; a place's chip shows itself when the keyboard
//   reaches it;
// - the incidents' banner is a label with the danger border and dot, at the top of the stage,
//   clear of the floor's note in the bottom corner; the red over the stage while the alarm rings is
//   upstream's, the one glow, and it holds still under reduced motion.
export const STYLE = `
html, body { margin: 0; height: 100%; overflow: hidden; background: transparent; }
body { font: 500 12px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: var(--o-fg); -webkit-font-smoothing: antialiased; }
#stage-wrap, #stage { position: absolute; inset: 0; }
/* PASEO: what the host draws over the stage's top right corner (client/styles.ts viewCorner) is cleared by what the scene
   puts at the stage's top edge: Exit and the help line in walk-in (ui/camera-bar.js) and the incident banner. The
   tallest corner is the touch one: inset 16 + border 2 + padding 8 + two wrapped rows of 44 with a gap of 4, then the
   unsaved-view note (gap 4, two lines of 16) = 154, rounded up to 156. */
:root { --corner-clear: 156px; }
#stage canvas { display: block; outline: none; touch-action: none; cursor: grab; }
#stage canvas:active { cursor: grabbing; }
#stage canvas.hovering { cursor: pointer; }
.labels { position: absolute; top: 0; left: 0; z-index: 1; pointer-events: none; }
[hidden] { display: none !important; }
svg.ic { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

.tag, .team-tag, .zone, .bubble, .ptip, .plc {
  background: var(--o-surface-raised); color: var(--o-fg); border: 1px solid var(--o-border);
}
.tag { display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px 4px 7px; border-radius: 6px; font-weight: 600; white-space: nowrap; transition: opacity .2s; }
.tag i { width: 8px; height: 8px; border-radius: 50%; display: block; flex: none; font-size: 0; }
.tag--sub { font-size: 11px; padding: 3px 7px 3px 6px; }
.tag--on { border-color: var(--o-accent); }
.tag--wait { border-color: var(--o-warning); }
.tag--stuck { border-color: var(--o-danger); }
.tag--boss { border-color: var(--o-muted); }
.tag--muted, .bubble--muted { opacity: 0; pointer-events: none; }
.tag--lost { cursor: pointer; pointer-events: auto; border-color: var(--o-danger); }
.tag--lost i { background: var(--o-danger); }
.tag-stuck, .tag-acct, .tag-model, .tag-team { margin-left: 2px; padding-left: 6px; border-left: 1px solid var(--o-border); font-size: 10px; font-weight: 600; color: var(--o-muted); }
.tag-stuck { color: var(--o-danger); }

.team-tag { display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px 4px 7px; border-radius: 6px; font-size: 11px; font-weight: 600; color: var(--o-muted); white-space: nowrap; }
.team-tag i { width: 8px; height: 8px; border-radius: 2px; flex: none; }
.team-tag { pointer-events: auto; cursor: pointer; }
.team-tag:hover { color: var(--o-fg); border-color: var(--o-muted); }

.bubble-wrap { width: 0; height: 0; position: relative; }
.bubble { position: absolute; left: 0; bottom: 22px; transform: translateX(-50%); width: max-content; max-width: 220px; display: flex; align-items: center; gap: 7px; padding: 5px 9px 5px 6px; border-radius: 8px; transition: opacity .2s; }
.b-ico { width: 20px; height: 20px; flex: none; border-radius: 5px; display: grid; place-items: center; background: var(--o-surface); color: var(--o-muted); }
.b-ico svg { width: 12px; height: 12px; }
.b-txt { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.bubble--wait { border-color: var(--o-warning); }
.bubble--wait .b-ico { color: var(--o-warning); }
.bubble--fail { border-color: var(--o-danger); }
.bubble--fail .b-ico { color: var(--o-danger); }
.bubble--sub { font-size: 11px; max-width: 180px; }
.cat-say { font-size: 11px; padding: 3px 8px; border-radius: 6px; background: var(--o-surface-raised); border: 1px solid var(--o-border); }

.zone { all: unset; box-sizing: border-box; pointer-events: auto; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px 4px 5px; border-radius: 6px; font: inherit; font-size: 11px; font-weight: 600; white-space: nowrap; background: var(--o-surface-raised); color: var(--o-muted); border: 1px solid var(--o-border); transition: opacity .2s; }
.z-ico { width: 16px; height: 16px; display: grid; place-items: center; border-radius: 4px; background: var(--o-surface); color: var(--o-muted); }
.z-ico svg { width: 10px; height: 10px; }
.z-live { color: var(--o-fg); font-weight: 500; }
.z-live::before { content: "·"; margin: 0 5px 0 1px; color: var(--o-muted); }
.zone:hover, .zone.zone--hot, .zone.zone--open { color: var(--o-fg); border-color: var(--o-muted); opacity: 1 !important; }
.zone:focus-visible, .team-tag:focus-visible, .tag--lost:focus-visible, .plc button:focus-visible { outline: 2px solid var(--o-fg); outline-offset: 2px; }
.zone--behind { opacity: .16; }
.labels:not(.show-zones) .zone:not(.zone--hot):not(.zone--open) { opacity: 0 !important; pointer-events: none; }
.labels:not(.show-zones) .zone:not(.zone--hot):not(.zone--open):focus-visible { opacity: 1 !important; }
@media (pointer: coarse) { .zone::after, .team-tag::after { content: ""; position: absolute; inset: -10px -6px; } }

.ptip { position: absolute; left: 0; top: 0; z-index: 3; pointer-events: none; max-width: 260px; display: flex; flex-direction: column; gap: 2px; padding: 7px 10px; border-radius: 8px; }
.ptip b { font-size: 12px; font-weight: 600; }
.ptip span { font-size: 11px; color: var(--o-muted); }
@media (hover: none) { .ptip { display: none; } }

.plc { position: absolute; left: 0; top: 0; z-index: 3; width: min(330px, calc(100% - 24px)); max-height: min(520px, calc(100% - 48px)); display: flex; flex-direction: column; border-radius: 12px; }
.plc-head { display: flex; align-items: flex-start; gap: 10px; padding: 12px 8px 8px 12px; }
.plc-ico { width: 32px; height: 32px; flex: none; display: grid; place-items: center; border-radius: 8px; background: var(--o-surface); color: var(--o-muted); }
.plc-ico svg { width: 16px; height: 16px; }
.plc-title { min-width: 0; flex: 1; }
.plc-title h3 { margin: 0; font-size: 14px; font-weight: 600; line-height: 1.3; }
.plc-title p { margin: 2px 0 0; font-size: 12px; color: var(--o-muted); }
.icon-btn { all: unset; box-sizing: border-box; width: 32px; height: 32px; display: grid; place-items: center; border-radius: 6px; cursor: pointer; color: var(--o-muted); }
.icon-btn:hover { background: var(--o-surface); color: var(--o-fg); }
.icon-btn svg { width: 16px; height: 16px; }
.plc-body { min-height: 0; overflow-y: auto; padding: 0 8px 12px; }
.plc-foot { padding: 8px 12px 12px; border-top: 1px solid var(--o-border); font-size: 12px; color: var(--o-muted); }
.pl-foot-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
.pl-group { margin: 12px 4px 4px; font-size: 11px; font-weight: 600; color: var(--o-muted); }
.pl-group:first-child { margin-top: 0; }
.pl-rows { display: flex; flex-direction: column; gap: 2px; }
.pl-row { all: unset; box-sizing: border-box; width: 100%; display: flex; align-items: flex-start; gap: 8px; padding: 6px; border-radius: 6px; }
button.pl-row { cursor: pointer; }
button.pl-row:hover { background: var(--o-surface); }
.pl-ico { --c: var(--o-muted); width: 24px; height: 24px; flex: none; display: grid; place-items: center; border-radius: 6px; color: var(--c); background: var(--o-surface); }
.pl-ico[data-tone="green"] { --c: var(--o-success); }
.pl-ico[data-tone="red"] { --c: var(--o-warning); }
.pl-ico[data-tone="blue"] { --c: var(--o-accent); }
.pl-ico svg { width: 12px; height: 12px; }
.pl-txt { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
.pl-txt b { font-size: 12px; font-weight: 500; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.pl-txt small { font-size: 11px; color: var(--o-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pl-row[data-state="done"] .pl-txt b { color: var(--o-muted); }
.pl-empty { margin: 4px 6px 8px; font-size: 12px; color: var(--o-muted); }
.pl-now { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 4px 6px; }
.pl-chip { all: unset; --c: var(--o-success); display: inline-flex; align-items: center; gap: 6px; max-width: 100%; padding: 4px 8px 4px 7px; border-radius: 6px; font-size: 12px; background: var(--o-surface); border: 1px solid var(--o-border); }
button.pl-chip { cursor: pointer; }
.pl-chip i { width: 8px; height: 8px; flex: none; border-radius: 50%; background: var(--c); }
.btn { all: unset; box-sizing: border-box; color: var(--o-fg); display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 32px; padding: 0 12px; border-radius: 6px; font-size: 12px; font-weight: 500; cursor: pointer; border: 1px solid var(--o-border); background: var(--o-surface); }
.btn:hover { border-color: var(--o-muted); }
.btn[disabled] { cursor: not-allowed; opacity: .5; }

.incident { all: unset; box-sizing: border-box; position: absolute; top: var(--corner-clear); left: 50%; transform: translateX(-50%); z-index: 2; max-width: calc(100% - 24px); display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px 6px 9px; border-radius: 8px; font-size: 12px; font-weight: 600; white-space: nowrap; cursor: pointer; background: var(--o-surface-raised); color: var(--o-fg); border: 1px solid var(--o-danger); }
.incident::before { content: ""; width: 8px; height: 8px; flex: none; border-radius: 50%; background: var(--o-danger); }
.incident-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.incident:hover { background: var(--o-surface); }
.incident:focus-visible { outline: 2px solid var(--o-fg); outline-offset: 2px; }
#stage-wrap.is-incident::after { content: ""; position: absolute; inset: 0; z-index: 1; pointer-events: none; box-shadow: inset 0 0 120px 30px rgba(255, 30, 30, .45); animation: incident-blink 1s ease-in-out infinite; }
@keyframes incident-blink { 50% { opacity: .3; } }

@media (prefers-reduced-motion: reduce) { .tag, .bubble, .zone { transition: none; } #stage-wrap.is-incident::after { animation: none; } }
`;
