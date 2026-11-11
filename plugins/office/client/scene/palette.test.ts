import { expect, test } from "vitest";
import type { PluginTheme } from "@getpaseo/plugin";
import { mix, parseColor, relativeLuminance, scenePalette, visorColor } from "./palette.js";

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
  expect(scenePalette(theme({ accent: "#20744a" })).monitorLit).toBe("#36815b");
  // The fixture's orange accent lies between its warning and danger hues; a grey has no hue.
  expect(scenePalette(theme({})).monitorLit).toBe("#73737c");
  expect(scenePalette(theme({ accent: "#e4e4e7" })).monitorLit).toBe("#73737c");
});

test("robots, lit screens, lights, notes and planes stand at least 3:1 off the room floor", () => {
  for (const palette of [scenePalette(theme({})), scenePalette(theme(DARK))]) {
    const parts = [
      palette.robotHead,
      palette.robotBody,
      palette.monitorLit,
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
