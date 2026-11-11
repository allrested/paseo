import { expect, test } from "vitest";
import type { PluginTheme } from "@getpaseo/plugin";
import {
  mix,
  parseColor,
  relativeLuminance,
  sceneVisor,
  scenePalette,
  visorColor,
} from "./palette.js";

function theme(colors: Partial<PluginTheme["colors"]>): PluginTheme {
  return {
    colors: {
      surface0: "#ffffff",
      surface1: "#f6f6f7",
      surface2: "#ececee",
      border: "#dcdce0",
      foreground: "#18181b",
      foregroundMuted: "#71717a",
      accent: "#d97757",
      accentForeground: "#ffffff",
      statusSuccess: "#2f855a",
      statusWarning: "#b7791f",
      statusDanger: "#c53030",
      ...colors,
    },
  };
}

const DARK = {
  surface0: "#0b0b0d",
  surface1: "#141417",
  surface2: "#1d1d21",
  foreground: "#f4f4f5",
};

// The app's own tokens (packages/app/src/styles/theme.ts through toPluginTheme): the light theme
// and the default dark one.
const APP_LIGHT = theme({
  surface0: "#ffffff",
  surface1: "#fafafa",
  surface2: "#f4f4f5",
  border: "#e4e4e7",
  foreground: "#1a1a1e",
  foregroundMuted: "#71717a",
  accent: "#20744a",
  statusSuccess: "#3e704a",
  statusWarning: "#7b5d39",
  statusDanger: "#9d433b",
});
const APP_DARK = theme({
  surface0: "#181b1a",
  surface1: "#1e2120",
  surface2: "#272a29",
  border: "#252b2a",
  foreground: "#fafafa",
  foregroundMuted: "#a1a5a4",
  accent: "#20744a",
  statusSuccess: "#6cb17b",
  statusWarning: "#c09664",
  statusDanger: "#d8847b",
});

/** The fixture's light and dark themes, then the app's. */
function palettes() {
  return [theme({}), theme(DARK), APP_LIGHT, APP_DARK].map((item) => scenePalette(item));
}

/** Every identity colour of the table, found through provider names that hash to it. */
function identityProviders(): string[] {
  const byColor = new Map<string, string>();
  for (let index = 0; index < 200; index += 1) {
    const provider = `provider-${index}`;
    const color = visorColor(provider, true);
    if (!byColor.has(color)) byColor.set(color, provider);
  }
  return [...byColor.values()];
}

/** HSV saturation, 0 for a grey to 1 for a pure colour. */
function saturation(color: string): number {
  const { r, g, b } = parseColor(color) ?? { r: 0, g: 0, b: 0 };
  const max = Math.max(r, g, b);
  return max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
}

/** Chroma, the channel spread over the full range: how much colour there is, 0 to 1. */
function chroma(color: string): number {
  const { r, g, b } = parseColor(color) ?? { r: 0, g: 0, b: 0 };
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
}

/** Hue in degrees, or null under a channel spread of 24 (the palette's grey). */
function hue(color: string): number | null {
  const { r, g, b } = parseColor(color) ?? { r: 0, g: 0, b: 0 };
  const max = Math.max(r, g, b);
  const spread = max - Math.min(r, g, b);
  if (spread < 24) return null;
  if (max === r) return (60 * ((g - b) / spread) + 360) % 360;
  if (max === g) return 60 * ((b - r) / spread) + 120;
  return 60 * ((r - g) / spread) + 240;
}

/** Degrees between two hues; a grey is as far as can be (180). */
function hueGap(left: string, right: string): number {
  const a = hue(left);
  const b = hue(right);
  if (a === null || b === null) return 180;
  const gap = Math.abs(a - b) % 360;
  return gap > 180 ? 360 - gap : gap;
}

/** WCAG contrast ratio, 1 to 21. */
function contrast(left: string, right: string): number {
  const [low = 0, high = 0] = [relativeLuminance(left), relativeLuminance(right)].sort(
    (a, b) => a - b,
  );
  return (high + 0.05) / (low + 0.05);
}

test("parses hex and rgb colours and ignores alpha", () => {
  expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255 });
  expect(parseColor("#10203a")).toEqual({ r: 16, g: 32, b: 58 });
  expect(parseColor("#10203aff")).toEqual({ r: 16, g: 32, b: 58 });
  expect(parseColor("rgba(1, 2, 3, 0.5)")).toEqual({ r: 1, g: 2, b: 3 });
  expect(parseColor("hsl(0 0% 0%)")).toBe(null);
});

test("mixes from one colour to another", () => {
  expect(mix("#000000", "#ffffff", 0)).toBe("#000000");
  expect(mix("#000000", "#ffffff", 1)).toBe("#ffffff");
  expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
  expect(mix("not a colour", "#808080", 0.5)).toBe("#808080");
});

test("luminance tells light from dark", () => {
  expect(relativeLuminance("#ffffff")).toBeCloseTo(1);
  expect(relativeLuminance("#000000")).toBe(0);
});

test("the palette follows the theme in light and dark", () => {
  const light = scenePalette(theme({}));
  expect(light.dark).toBe(false);
  expect(light.background).toBe("#ffffff");
  expect(light.floor).toBe("#fafafa");
  expect(light.roomFloor).toBe("#ededed");
  expect(light.lightWarning).toBe("#c07200");
  expect(light.lightDanger).toBe("#db0000");

  const dark = scenePalette(theme(DARK));
  expect(dark.dark).toBe(true);
  expect(dark.background).toBe("#0b0b0d");
  expect(dark.floor).toBe("#0b0b0d");
  expect(dark.roomFloor).toBe("#171719");
  expect(dark.lightWarning).toBe("#f39000");
  expect(dark.lightDanger).toBe("#ff0505");
  expect(dark.shadowOpacity).toBeGreaterThan(light.shadowOpacity);
});

test("visors take the app's identity colour of the provider, per scheme", () => {
  expect(visorColor("claude", false)).toBe("#3e6e5d");
  expect(visorColor("claude", true)).toBe("#6cae96");
  expect(visorColor("codex", false)).toBe("#3d6985");
  expect(visorColor("codex", false)).toBe(visorColor("codex", false));
});

test("lit screens take the app accent, but never a hue that sits with the state colours", () => {
  // By night the accent at 5:1 off the floor; by day lifted a quarter of the way from the desk to white.
  expect(scenePalette(theme({ ...DARK, accent: "#20744a" })).monitorLit).toBe("#549474");
  expect(scenePalette(theme({ accent: "#20744a" })).monitorLit).toBe("#f8faf9");
  // The fixture's orange accent lies between its warning and danger hues; a grey has no hue.
  expect(scenePalette(theme(DARK)).monitorLit).toBe("#86868e");
  expect(scenePalette(theme({ ...DARK, accent: "#e4e4e7" })).monitorLit).toBe("#86868e");
});

test("robots, lit screens by night, lamps, notes and planes stand at least 3:1 off the room floor", () => {
  for (const palette of [scenePalette(theme({})), scenePalette(theme(DARK))]) {
    // By day a lit screen is lighter than its desk, and a near-white floor leaves no 3:1 above it;
    // it is held against the unused screen instead (see "a working desk is never darker").
    const parts = [
      ...(palette.dark ? [palette.monitorLit] : []),
      palette.robotHead,
      palette.robotBody,
      palette.lampOn,
      palette.lightWarning,
      palette.lightDanger,
      palette.noteTask,
      palette.noteClaimed,
      palette.noteNote,
      palette.plane,
    ];
    const weakest = Math.min(...parts.map((part) => contrast(part, palette.roomFloor)));
    expect(weakest).toBeGreaterThanOrEqual(3);
  }
});

test("the warning light is lighter than the danger light, so the two differ without hue", () => {
  for (const palette of [scenePalette(theme({})), scenePalette(theme(DARK))]) {
    expect(contrast(palette.lightWarning, palette.lightDanger)).toBeGreaterThanOrEqual(1.4);
    expect(relativeLuminance(palette.lightWarning)).toBeGreaterThan(
      relativeLuminance(palette.lightDanger),
    );
  }
});

test("a desk top is lighter than its floor, so in a light room the robots are the dark things", () => {
  for (const palette of [scenePalette(theme({})), scenePalette(theme(DARK))]) {
    expect(relativeLuminance(palette.desk)).toBeGreaterThan(relativeLuminance(palette.roomFloor));
  }
  expect(scenePalette(theme({})).desk).toBe("#f8f8f8");
  expect(scenePalette(theme(DARK)).desk).toBe("#37373a");
});

test("glass is thin: the room behind a wall shows through it", () => {
  for (const palette of [scenePalette(theme({})), scenePalette(theme(DARK))]) {
    expect(palette.wallOpacity).toBe(0.2);
  }
});

test("an unlit lamp is a grey that stands back from a lit one", () => {
  for (const palette of [scenePalette(theme({})), scenePalette(theme(DARK))]) {
    const off = parseColor(palette.lampOff) ?? { r: 0, g: 0, b: 255 };
    expect(Math.max(off.r, off.g, off.b) - Math.min(off.r, off.g, off.b)).toBeLessThan(24);
    expect(contrast(palette.lampOff, palette.roomFloor)).toBeLessThan(
      contrast(palette.lampOn, palette.roomFloor),
    );
  }
});

test("eyes are dark in both schemes and show on every visor", () => {
  for (const palette of palettes()) {
    for (const provider of identityProviders()) {
      expect(contrast(palette.robotEye, sceneVisor(provider, palette))).toBeGreaterThanOrEqual(3);
    }
  }
});

test("a lit desk throws a pool of light by night; by day the pool is faint", () => {
  const day = scenePalette(theme({}));
  const night = scenePalette(theme(DARK));
  expect(relativeLuminance(night.glow)).toBeGreaterThan(relativeLuminance(night.desk));
  expect(night.glowOpacity).toBeGreaterThan(day.glowOpacity);
  expect(day.glowOpacity).toBeGreaterThan(0);
});

test("a visor near the warning or danger hue is muted to a tinted neutral; cool ones keep their colour", () => {
  const providers = identityProviders();
  expect(providers).toHaveLength(10);
  for (const palette of palettes()) {
    for (const provider of providers) {
      const identity = visorColor(provider, true);
      const visor = sceneVisor(provider, palette);
      const far =
        hueGap(identity, palette.lightWarning) >= 45 && hueGap(identity, palette.lightDanger) >= 45;
      // A cool identity colour is the app's own; a warm one keeps its hue at 0.14 saturation.
      expect(far || saturation(visor) <= 0.14).toBe(true);
      expect(visor === identity).toBe(far);
      expect(hueGap(visor, identity)).toBeLessThan(3);
      // The amber lamp holds at least 1.8 times the colour of any visor.
      expect(chroma(palette.lightWarning)).toBeGreaterThanOrEqual(1.8 * chroma(visor));
    }
  }
  const app = scenePalette(APP_DARK);
  expect(sceneVisor("claude", app)).toBe(visorColor("claude", true));
  expect(sceneVisor("pi", app)).not.toBe(visorColor("pi", true));
});

test("a working desk is never darker than an idle one, by day or by night", () => {
  for (const palette of palettes()) {
    // The lit screen and its pool are at least as light as the desk; an unused screen is darker.
    expect(relativeLuminance(palette.monitorLit)).toBeGreaterThanOrEqual(
      relativeLuminance(palette.desk),
    );
    expect(relativeLuminance(palette.glow)).toBeGreaterThanOrEqual(relativeLuminance(palette.desk));
    expect(relativeLuminance(palette.monitorDim)).toBeLessThan(relativeLuminance(palette.desk));
    expect(contrast(palette.monitorLit, palette.monitorDim)).toBeGreaterThanOrEqual(1.4);
  }
});

test("a lit screen and its pool are never warm and never a lamp's colour", () => {
  for (const palette of palettes()) {
    for (const light of [palette.monitorLit, palette.glow]) {
      expect(hueGap(light, palette.lightWarning)).toBeGreaterThanOrEqual(45);
      expect(hueGap(light, palette.lightDanger)).toBeGreaterThanOrEqual(45);
    }
    expect(contrast(palette.monitorLit, palette.lampOn)).toBeGreaterThanOrEqual(1.5);
  }
});

test("the steady lamp is a quiet neutral light that shows on the head", () => {
  for (const palette of palettes()) {
    expect(saturation(palette.lampOn)).toBeLessThanOrEqual(0.12);
    expect(contrast(palette.lampOn, palette.robotHead)).toBeGreaterThanOrEqual(2.5);
    // Saturated colour on a robot is kept for the two lamps that need the owner.
    expect(chroma(palette.lightWarning)).toBeGreaterThanOrEqual(0.6);
    expect(chroma(palette.lightDanger)).toBeGreaterThanOrEqual(0.6);
  }
});
