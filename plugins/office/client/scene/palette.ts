import type { PluginTheme } from "@getpaseo/plugin";

export interface ScenePalette {
  dark: boolean;
  /** The canvas behind everything: the app surface. */
  background: string;
  /** The ground around the rooms. */
  floor: string;
  /** What robots, desks, lights and notes are seen against. */
  roomFloor: string;
  wall: string;
  wallOpacity: number;
  desk: string;
  monitorDim: string;
  monitorLit: string;
  robotBody: string;
  robotHead: string;
  /** Eyes are drawn on the visor. */
  robotEye: string;
  /** The lamp on a robot's antenna: unlit, and lit while the robot works. */
  lampOff: string;
  lampOn: string;
  /** The pool of light a lit screen throws on its desk. */
  glow: string;
  glowOpacity: number;
  shadowOpacity: number;
  lightWarning: string;
  lightDanger: string;
  board: string;
  noteTask: string;
  noteClaimed: string;
  noteNote: string;
  label: string;
  labelText: string;
  plane: string;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

const FALLBACK: Rgb = { r: 128, g: 128, b: 128 };
const WHITE = "#ffffff";
const BLACK = "#000000";
/** Channel spread (0-255) under which a colour counts as grey. */
const GREY_SPREAD = 24;
/** An accent this close (degrees of hue) to the theme's warning or danger is not used. */
const STATE_HUE_GUARD = 45;
/** A visor near the warning or danger hue keeps its hue at this HSV saturation: a tinted neutral. */
const VISOR_SATURATION = 0.14;
/** The steady lamp is a light, not a colour: its HSV saturation stays under this. */
const LAMP_SATURATION = 0.1;

export function parseColor(value: string): Rgb | null {
  const text = value.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(text);
  if (short) {
    const [, r = "0", g = "0", b = "0"] = short;
    return { r: parseInt(r + r, 16), g: parseInt(g + g, 16), b: parseInt(b + b, 16) };
  }
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/.exec(text);
  if (long) {
    const [, r = "00", g = "00", b = "00"] = long;
    return { r: parseInt(r, 16), g: parseInt(g, 16), b: parseInt(b, 16) };
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(text);
  if (rgb) {
    const [, r = "0", g = "0", b = "0"] = rgb;
    return { r: Number(r), g: Number(g), b: Number(b) };
  }
  return null;
}

function toHex({ r, g, b }: Rgb): string {
  const part = (channel: number) =>
    Math.round(Math.min(255, Math.max(0, channel)))
      .toString(16)
      .padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** `amount` 0 gives `from`, 1 gives `to`. An unreadable colour counts as mid grey. */
export function mix(from: string, to: string, amount: number): string {
  const a = parseColor(from) ?? FALLBACK;
  const b = parseColor(to) ?? FALLBACK;
  return toHex({
    r: a.r + (b.r - a.r) * amount,
    g: a.g + (b.g - a.g) * amount,
    b: a.b + (b.b - a.b) * amount,
  });
}

/** WCAG relative luminance, 0 for black to 1 for white. */
export function relativeLuminance(color: string): number {
  const { r, g, b } = parseColor(color) ?? FALLBACK;
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** `color` mixed towards white or black until its luminance is `target`; the hue stays. */
function atLuminance(color: string, target: number): string {
  const lighten = relativeLuminance(color) < target;
  const end = lighten ? WHITE : BLACK;
  let amount = 0;
  for (let step = 0.5; step > 0.0005; step /= 2) {
    const reached = relativeLuminance(mix(color, end, amount + step));
    const overshoots = lighten ? reached > target : reached < target;
    if (!overshoots) amount += step;
  }
  return mix(color, end, amount);
}

/**
 * `color` re-lit to a WCAG contrast of `ratio`:1 against `ground`: lighter than a dark ground,
 * darker than a light one. Mixing stops just short of the target, so plan ratios leave a margin.
 */
function standOff(color: string, ground: string, ratio: number): string {
  const base = relativeLuminance(ground);
  // Under 0.18 a surface contrasts more with white than with black.
  const target = base < 0.18 ? ratio * (base + 0.05) - 0.05 : (base + 0.05) / ratio - 0.05;
  return atLuminance(color, target);
}

/** Hue in degrees, or null for a colour too grey to have one. */
function hueOf(color: string): number | null {
  const { r, g, b } = parseColor(color) ?? FALLBACK;
  const max = Math.max(r, g, b);
  const spread = max - Math.min(r, g, b);
  if (spread < GREY_SPREAD) return null;
  if (max === r) return (60 * ((g - b) / spread) + 360) % 360;
  if (max === g) return 60 * ((b - r) / spread) + 120;
  return 60 * ((r - g) / spread) + 240;
}

function hueGap(left: number, right: number): number {
  const gap = Math.abs(left - right) % 360;
  return gap > 180 ? 360 - gap : gap;
}

/** The colour's own hue at full strength; a grey stays as it is. */
function saturated(color: string): string {
  const { r, g, b } = parseColor(color) ?? FALLBACK;
  const min = Math.min(r, g, b);
  const spread = Math.max(r, g, b) - min;
  if (spread < GREY_SPREAD) return color;
  const stretch = (channel: number) => ((channel - min) / spread) * 255;
  return toHex({ r: stretch(r), g: stretch(g), b: stretch(b) });
}

/** `color` with its HSV saturation at most `limit`; hue and brightness stay. */
function withSaturation(color: string, limit: number): string {
  const { r, g, b } = parseColor(color) ?? FALLBACK;
  const max = Math.max(r, g, b);
  const spread = max - Math.min(r, g, b);
  if (spread === 0 || spread <= limit * max) return color;
  const keep = (limit * max) / spread;
  // Rounded up, so the spread never ends over the limit.
  const toward = (channel: number) => Math.ceil(max - (max - channel) * keep);
  return toHex({ r: toward(r), g: toward(g), b: toward(b) });
}

/** True when `color` has a hue within `STATE_HUE_GUARD` of any of `states`. */
function nearStateHue(color: string, states: readonly string[]): boolean {
  const hue = hueOf(color);
  if (hue === null) return false;
  return states.some((state) => {
    const stateHue = hueOf(state);
    return stateHue !== null && hueGap(hue, stateHue) < STATE_HUE_GUARD;
  });
}

/**
 * What tints the glass, the lit screens and the notes: the app accent, so the office changes with
 * the theme. Amber and red are kept for "needs you", so an accent with no hue (Zinc's near-white)
 * or one near the theme's warning or danger hue (Claude's orange) gives way to the muted
 * foreground and the office goes monochrome.
 */
function sceneTint(colors: PluginTheme["colors"]): string {
  if (hueOf(colors.accent) === null) return colors.foregroundMuted;
  const nearState = nearStateHue(colors.accent, [colors.statusWarning, colors.statusDanger]);
  return nearState ? colors.foregroundMuted : colors.accent;
}

/**
 * WCAG contrast each part holds against the room floor; nothing that carries state goes under 3:1.
 * A note's ratio is against what the note is pinned to (`pinned` in scenePalette). Amber is a
 * light colour, so on a light floor the warning lamp can only darken to just past 3:1. The head is
 * the darker part of a robot in both schemes: the visor sits on it. An unlit lamp says nothing, so
 * it alone stays under 3:1. The steady lamp is the foreground, a light by night; by day it is a
 * mid neutral, past 3:1 off the floor and 2.5:1 off the dark head.
 */
interface ContrastPlan {
  robotHead: number;
  robotBody: number;
  lampOff: number;
  lampOn: number;
  wall: number;
  lightWarning: number;
  lightDanger: number;
  noteTask: number;
  noteClaimed: number;
  noteNote: number;
}

const LIGHT_PLAN: ContrastPlan = {
  robotHead: 8,
  robotBody: 5.2,
  lampOff: 2,
  lampOn: 3.1,
  wall: 3,
  lightWarning: 3.2,
  lightDanger: 4.5,
  noteTask: 4.5,
  noteClaimed: 3.8,
  noteNote: 3.2,
};

/** By night a lit screen holds this contrast against the room floor. */
const NIGHT_SCREEN = 5;
/** By night the pool of light is this far from its screen's colour towards the foreground. */
const NIGHT_POOL_PALE = 0.6;
/** By day an unused screen is this far from its desk towards the foreground. */
const DAY_SCREEN_DIM = 0.3;

const DARK_PLAN: ContrastPlan = {
  robotHead: 3.2,
  robotBody: 4,
  lampOff: 2.2,
  lampOn: 12,
  wall: 5.4,
  lightWarning: 7.5,
  lightDanger: 4.5,
  noteTask: 4.5,
  noteClaimed: 3.8,
  noteNote: 3.2,
};

/**
 * The office in the app's own tones. Surfaces are steps between the app surface and the
 * foreground (ground, room floor, desk); robots are the muted foreground as graphite; the accent tints the
 * glass and lights the screens; a robot's lamp is a neutral while it rests or works, and takes the
 * theme's warning and danger hues at full strength while it needs the owner, which are used
 * nowhere else. Screens, visors, eyes, lamps and notes are drawn unlit, so their colours reach
 * the screen as given. A plane is lit paper: its two wings differ in tone.
 */
export function scenePalette(theme: PluginTheme): ScenePalette {
  const c = theme.colors;
  const dark = relativeLuminance(c.surface0) < 0.4;
  const plan = dark ? DARK_PLAN : LIGHT_PLAN;
  // A room is a tile on the page, like a card in the structure view.
  const roomFloor = mix(c.surface0, c.foreground, dark ? 0.05 : 0.08);
  const tint = sceneTint(c);
  const onFloor = (color: string, ratio: number) => standOff(color, roomFloor, ratio);
  const desk = dark ? mix(c.surface2, c.foreground, 0.12) : mix(c.surface0, c.foreground, 0.03);
  // By night a lit screen is the light in the room. By day a near-white floor leaves no room to
  // stand a light off it, so the screen is the tint lifted a quarter of the way from its desk to
  // white: the lightest thing on the desk, like a light table in daylight.
  const monitorLit = dark
    ? onFloor(tint, NIGHT_SCREEN)
    : atLuminance(tint, relativeLuminance(desk) + (1 - relativeLuminance(desk)) / 4);
  const board = dark ? mix(c.surface2, c.foreground, 0.18) : mix(c.surface1, c.surface1, 0);
  // A note is seen against the whiteboard or a desk, not the bare floor. By day it is darker
  // than all three, and the floor is the darkest of them. By night it is lighter than all
  // three, and the whiteboard is the lightest: held against the floor, a note's tint came out
  // 1.7:1 off its whiteboard.
  const pinned = (color: string, ratio: number) => standOff(color, dark ? board : roomFloor, ratio);
  return {
    dark,
    background: mix(c.surface0, c.surface0, 0),
    // The ground is the page: on a tall phone the ground plane ends inside the canvas, and a
    // tone of its own would show there as a hard edge. Light themes get a hair off pure white.
    floor: mix(c.surface0, c.foreground, dark ? 0 : 0.02),
    roomFloor,
    // Glass is mostly neutral; the tint only colours it faintly. It is thin: a wall's face is
    // shaded, and at a third opaque the front wall of a room came out as a grey band.
    wall: onFloor(mix(c.foregroundMuted, tint, 0.4), plan.wall),
    wallOpacity: 0.2,
    // A desk top is lighter than the floor in both schemes, like card on a model's base. In a
    // light room that leaves the robots as the only dark things, so empty desks recede.
    desk,
    // An unused screen is a shade darker than the desk it lies in, so empty desks recede.
    monitorDim: mix(desk, dark ? BLACK : c.foreground, dark ? 0.32 : DAY_SCREEN_DIM),
    monitorLit,
    robotBody: onFloor(c.foregroundMuted, plan.robotBody),
    // Dark enough in both schemes for the visor, an identity colour for a dark surface.
    robotHead: onFloor(c.foregroundMuted, plan.robotHead),
    // Visors are identity colours for a dark surface in both schemes, so eyes are dark in both.
    robotEye: dark ? mix(c.surface0, BLACK, 0.45) : mix(c.foreground, BLACK, 0.1),
    // Muted for an agent at rest. One at work has a quiet light, not a colour: saturated colour on
    // a robot is kept for the two lamps that need the owner.
    lampOff: onFloor(c.foregroundMuted, plan.lampOff),
    lampOn: onFloor(withSaturation(c.foreground, LAMP_SATURATION), plan.lampOn),
    // The pool is never darker than the desk it lies on: by night it is the light in the room,
    // by day a wash lighter than the desk. By night it is pale: at the screen's own strength a
    // green pool ran into the green visor above it.
    glow: dark ? mix(monitorLit, c.foreground, NIGHT_POOL_PALE) : monitorLit,
    glowOpacity: dark ? 0.55 : 0.3,
    shadowOpacity: dark ? 0.35 : 0.18,
    lightWarning: onFloor(saturated(c.statusWarning), plan.lightWarning),
    lightDanger: onFloor(saturated(c.statusDanger), plan.lightDanger),
    board,
    // Notes stay out of the warning and danger hues: an open task is the strongest slip, a
    // claimed one fades, a note takes the tint.
    noteTask: pinned(c.foregroundMuted, plan.noteTask),
    noteClaimed: pinned(c.foregroundMuted, plan.noteClaimed),
    noteNote: pinned(tint, plan.noteNote),
    // A room's name plate is cut from its floor, so it shows on the page and on the glass.
    label: roomFloor,
    labelText: mix(c.foreground, c.foreground, 0),
    // Paper in the foreground's own tone, so a plane that leaves a whiteboard is not taken for
    // one of the notes on it: by day it is darker than a task's note, by night lighter.
    plane: mix(c.foreground, c.surface0, dark ? 0 : 0.15),
  };
}

// Copied from packages/app/src/styles/identity-colors.ts (IDENTITY_COLOR_NAMES,
// IDENTITY_FOREGROUND_LIGHT/DARK, hashIdentityKey); a plugin cannot import app code. Order is
// load-bearing there and here: the hash indexes into it.
const IDENTITY_NAMES = [
  "violet",
  "sky",
  "emerald",
  "orange",
  "pink",
  "indigo",
  "teal",
  "red",
  "amber",
  "blue",
] as const;
type IdentityName = (typeof IDENTITY_NAMES)[number];
const IDENTITY_LIGHT: Record<IdentityName, string> = {
  violet: "#6d49b5",
  sky: "#3d6985",
  emerald: "#3e6e5d",
  orange: "#845838",
  pink: "#974168",
  indigo: "#5251c2",
  teal: "#3e6d6c",
  red: "#9c4243",
  amber: "#716239",
  blue: "#39649e",
};
const IDENTITY_DARK: Record<IdentityName, string> = {
  violet: "#a392d5",
  sky: "#6aa6ce",
  emerald: "#6cae96",
  orange: "#cc8f64",
  pink: "#d87da3",
  indigo: "#9299d5",
  teal: "#6cacab",
  red: "#d88381",
  amber: "#b29d64",
  blue: "#7ba1d5",
};

function hashIdentityKey(key: string): number {
  let hash = 0;
  for (const character of key) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash;
}

/** The provider's identity colour, as a foreground on a dark (`dark`) or a light surface. */
export function visorColor(provider: string, dark: boolean): string {
  const name = IDENTITY_NAMES[hashIdentityKey(provider) % IDENTITY_NAMES.length] ?? "violet";
  return dark ? IDENTITY_DARK[name] : IDENTITY_LIGHT[name];
}

/**
 * The visor of a robot: the provider's identity colour for a dark surface (heads are graphite in
 * both schemes). The waiting robot is the one warm spot, so an identity colour near the warning or
 * danger hue keeps its hue, and providers still differ, at the saturation of a tinted neutral.
 */
export function sceneVisor(provider: string, palette: ScenePalette): string {
  const identity = visorColor(provider, true);
  const warm = nearStateHue(identity, [palette.lightWarning, palette.lightDanger]);
  return warm ? withSaturation(identity, VISOR_SATURATION) : identity;
}
