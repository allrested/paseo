import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { paseoDesignVariables, parseColor } from "./design-tokens";

const CHECKED_IN = new URL("../../../../plugins/design/server/paseo-tokens.json", import.meta.url);

describe("Paseo design tokens for design mode", () => {
  it("matches the copy design mode ships (UPDATE_DESIGN_TOKENS=1 rewrites it)", () => {
    const current = `${JSON.stringify(paseoDesignVariables(), null, 2)}\n`;
    if (process.env.UPDATE_DESIGN_TOKENS === "1") writeFileSync(CHECKED_IN, current);
    expect(readFileSync(CHECKED_IN, "utf8")).toBe(current);
  });

  it("has one mode per theme, the app's default first", () => {
    const [collection] = Object.values(paseoDesignVariables().meta.variableCollections);
    expect(collection.name).toBe("Tokens");
    expect(collection.modes.map((mode) => mode.name)).toEqual([
      "Paseo",
      "Light",
      "Zinc",
      "Midnight",
      "Claude",
      "Ghostty",
      "Pure Black",
    ]);
    expect(collection.defaultModeId).toBe(collection.modes[0].modeId);
  });

  it("gives a colour a value in every mode and a scale the same value in each", () => {
    const { variables } = paseoDesignVariables().meta;
    expect(variables["v:color/foreground"].valuesByMode["m:light"]).not.toEqual(
      variables["v:color/foreground"].valuesByMode["m:paseo"],
    );
    expect(new Set(Object.values(variables["v:spacing/4"].valuesByMode))).toEqual(new Set([16]));
    expect(variables["v:spacing/0_5"].valuesByMode["m:paseo"]).toBe(2);
  });

  it("reads hex and rgba colours", () => {
    expect(parseColor("#ffffff")).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    expect(parseColor("#00000080")).toEqual({ r: 0, g: 0, b: 0, a: 0.502 });
    expect(parseColor("rgba(0, 0, 0, 0.15)")).toEqual({ r: 0, g: 0, b: 0, a: 0.15 });
    expect(() => parseColor("tomato")).toThrow("Unsupported colour tomato");
  });
});
