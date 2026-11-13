import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fromVariables, sameTokens, toVariables, TokensError } from "./tokens.js";

const file = {
  color: {
    $type: "color",
    accent: { $value: "#3366cc" },
    muted: { $value: "#33669980" },
    link: { $value: "{color.accent}" },
  },
  space: { "4": { $value: "16px", $type: "dimension" } },
  font: {
    body: { $value: "Inter", $type: "fontFamily" },
    weight: { $value: 500, $type: "fontWeight" },
  },
  shadow: {
    card: {
      $type: "shadow",
      $value: { color: "#000", offsetX: "0px", offsetY: "1px", blur: "2px", spread: "0px" },
    },
  },
};

describe("toVariables", () => {
  it("makes one collection Tokens with one mode Default and a variable per simple token", () => {
    const { variables, warnings } = toVariables(file);
    const meta = variables.meta;
    expect(Object.values(meta.variableCollections)).toEqual([
      expect.objectContaining({
        name: "Tokens",
        modes: [{ modeId: "m:default", name: "Default" }],
      }),
    ]);
    const byName = Object.fromEntries(Object.values(meta.variables).map((v) => [v.name, v]));
    expect(byName["color/accent"]).toMatchObject({
      resolvedType: "COLOR",
      valuesByMode: { "m:default": { r: 0.2, g: 0.4, b: 0.8, a: 1 } },
    });
    expect(byName["color/muted"].valuesByMode["m:default"]).toEqual({
      r: 0.2,
      g: 0.4,
      b: 0.6,
      a: 128 / 255,
    });
    expect(byName["color/link"].valuesByMode["m:default"]).toEqual({
      type: "VARIABLE_ALIAS",
      id: byName["color/accent"].id,
    });
    expect(byName["space/4"]).toMatchObject({
      resolvedType: "FLOAT",
      valuesByMode: { "m:default": 16 },
    });
    expect(byName["font/body"]).toMatchObject({
      resolvedType: "STRING",
      valuesByMode: { "m:default": "Inter" },
    });
    expect(byName["font/weight"]).toMatchObject({
      resolvedType: "FLOAT",
      valuesByMode: { "m:default": 500 },
    });
    expect(byName["shadow/card"]).toBeUndefined();
    expect(warnings).toEqual(["shadow.card: shadow tokens stay in the file and are not imported"]);
  });
  it("inherits $type from a group and refuses a token with no type", () => {
    expect(() => toVariables({ x: { $value: "#fff" } })).toThrow(
      new TokensError("x: no $type on the token or its groups"),
    );
  });
  it("refuses an alias to a token that does not exist", () => {
    expect(() => toVariables({ color: { $type: "color", a: { $value: "{color.b}" } } })).toThrow(
      new TokensError("color.a: alias {color.b} names no token"),
    );
  });
  it("refuses a dimension that is not px", () => {
    expect(() => toVariables({ s: { $type: "dimension", $value: "1rem" } })).toThrow(
      new TokensError("s: only px dimensions are supported, got 1rem"),
    );
  });
});

describe("fromVariables and sameTokens", () => {
  it("writes changed values back in the file's own form and keeps the rest", () => {
    const { variables } = toVariables(file);
    const exported = structuredClone(variables);
    const accent = Object.values(exported.meta.variables).find((v) => v.name === "color/accent")!;
    accent.valuesByMode["m:default"] = { r: 1, g: 0, b: 0, a: 1 };
    const space = Object.values(exported.meta.variables).find((v) => v.name === "space/4")!;
    space.valuesByMode["m:default"] = 20;
    const next = fromVariables(exported, file);
    expect(next.color).toMatchObject({
      accent: { $value: "#ff0000" },
      link: { $value: "{color.accent}" },
    });
    expect(next.space).toEqual({ "4": { $value: "20px", $type: "dimension" } });
    expect(next.shadow).toEqual(file.shadow);
    expect(sameTokens(file, exported)).toBe(false);
    expect(sameTokens(next, exported)).toBe(true);
  });
  it("adds a token FigCraft gained, under its slash path, typed", () => {
    const { variables } = toVariables(file);
    const exported = structuredClone(variables);
    exported.meta.variables["v:new"] = {
      id: "v:new",
      name: "radius/card",
      variableCollectionId: Object.keys(exported.meta.variableCollections)[0],
      resolvedType: "FLOAT",
      valuesByMode: { "m:default": 12 },
    };
    expect(fromVariables(exported, file).radius).toEqual({ card: { $value: 12, $type: "number" } });
  });
  it("reads only the Tokens collection's default mode", () => {
    expect(sameTokens(file, { meta: { variableCollections: {}, variables: {} } })).toBe(false);
  });
  it("keeps an unchanged token in the file's own form", () => {
    const own = {
      c: { $type: "color", a: { $value: "#36C" } },
      s: { $type: "number", n: { $value: 0.1 } },
    };
    const { variables } = toVariables(own);
    const exported = structuredClone(variables);
    for (const v of Object.values(exported.meta.variables)) {
      const value = v.valuesByMode["m:default"];
      // FigCraft hands values back as 32-bit floats.
      v.valuesByMode["m:default"] =
        typeof value === "number"
          ? Math.fround(value)
          : ({
              ...(value as object),
              r: Math.fround(0.2),
              g: Math.fround(0.4),
              b: Math.fround(0.8),
            } as never);
    }
    expect(fromVariables(exported, own)).toEqual(own);
    expect(sameTokens(own, exported)).toBe(true);
  });
  it("matches what the real FigCraft exported (fixture), with its own ids, modes and floats", () => {
    const fixture = JSON.parse(
      readFileSync(new URL("../test/fixtures/variable-export.json", import.meta.url), "utf8"),
    ) as { text: string };
    const exported = JSON.parse(fixture.text) as unknown;
    const imported = {
      color: { $type: "color", accent: { $value: "#3366cc" } },
      space: { "4": { $type: "dimension", $value: "16px" } },
    };
    expect(sameTokens(imported, exported)).toBe(true);
    expect(
      sameTokens({ ...imported, space: { "4": { $type: "dimension", $value: "20px" } } }, exported),
    ).toBe(false);
  });
});
