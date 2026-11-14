// Paseo's design system as FigCraft local variables, for design mode's default tokens.
// plugins/design/server/paseo-tokens.json is this output; design-tokens.test.ts keeps it current.
import {
  BORDER_RADIUS,
  BORDER_WIDTH,
  darkClaudeTheme,
  darkGhosttyTheme,
  darkMidnightTheme,
  darkPureBlackTheme,
  darkTheme,
  darkZincTheme,
  FONT_SIZE,
  ICON_SIZE,
  lightTheme,
  OPACITY,
  SPACING,
} from "./theme";

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface DesignVariable {
  id: string;
  name: string;
  variableCollectionId: string;
  resolvedType: "COLOR" | "FLOAT";
  valuesByMode: Record<string, Rgba | number>;
}

export interface DesignVariablesJson {
  meta: {
    variableCollections: Record<
      string,
      {
        id: string;
        name: string;
        modes: { modeId: string; name: string }[];
        defaultModeId: string;
        variableIds: string[];
      }
    >;
    variables: Record<string, DesignVariable>;
  };
}

const COLLECTION = "c:tokens";

// The first mode is the default: the app's default theme.
const MODES = [
  { modeId: "m:paseo", name: "Paseo", colors: darkTheme.colors },
  { modeId: "m:light", name: "Light", colors: lightTheme.colors },
  { modeId: "m:zinc", name: "Zinc", colors: darkZincTheme.colors },
  { modeId: "m:midnight", name: "Midnight", colors: darkMidnightTheme.colors },
  { modeId: "m:claude", name: "Claude", colors: darkClaudeTheme.colors },
  { modeId: "m:ghostty", name: "Ghostty", colors: darkGhosttyTheme.colors },
  { modeId: "m:pure-black", name: "Pure Black", colors: darkPureBlackTheme.colors },
] as const;

const SCALES: [string, Record<string, number>][] = [
  ["spacing", SPACING],
  ["font-size", FONT_SIZE],
  ["icon-size", ICON_SIZE],
  ["radius", BORDER_RADIUS],
  ["border-width", BORDER_WIDTH],
  ["opacity", OPACITY],
];

function channel(hex: string): number {
  return Math.round((parseInt(hex, 16) / 255) * 1000) / 1000;
}

export function parseColor(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value);
  if (hex) {
    const [rgb, alpha] = [hex[1], hex[2]];
    return {
      r: channel(rgb.slice(0, 2)),
      g: channel(rgb.slice(2, 4)),
      b: channel(rgb.slice(4, 6)),
      a: alpha ? channel(alpha) : 1,
    };
  }
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
  if (short)
    return parseColor(`#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`);
  const rgba = /^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)$/.exec(value);
  if (rgba) {
    const [r, g, b] = [rgba[1], rgba[2], rgba[3]].map(
      (part) => Math.round((Number(part) / 255) * 1000) / 1000,
    );
    return { r, g, b, a: rgba[4] === undefined ? 1 : Number(rgba[4]) };
  }
  throw new Error(`Unsupported colour ${value}`);
}

/** The theme's flat colours by name; nested groups (palette, syntax, terminal) stay out. */
function flatColors(colors: object): Map<string, string> {
  return new Map(
    Object.entries(colors).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

export function paseoDesignVariables(): DesignVariablesJson {
  const variables: Record<string, DesignVariable> = {};
  const add = (
    name: string,
    resolvedType: DesignVariable["resolvedType"],
    value: (mode: (typeof MODES)[number]) => Rgba | number,
  ) => {
    const id = `v:${name}`;
    variables[id] = {
      id,
      name,
      variableCollectionId: COLLECTION,
      resolvedType,
      valuesByMode: Object.fromEntries(MODES.map((mode) => [mode.modeId, value(mode)])),
    };
  };

  const byMode = new Map(MODES.map((mode) => [mode.modeId, flatColors(mode.colors)]));
  const names = [...byMode.get(MODES[0].modeId)!.keys()];
  for (const [modeId, colors] of byMode) {
    const missing = names.filter((name) => !colors.has(name));
    const extra = [...colors.keys()].filter((name) => !names.includes(name));
    if (missing.length > 0 || extra.length > 0) {
      throw new Error(`Theme ${modeId} colours differ: missing ${missing}, extra ${extra}`);
    }
  }
  for (const name of names) {
    add(`color/${name}`, "COLOR", (mode) => parseColor(byMode.get(mode.modeId)!.get(name)!));
  }
  for (const [group, scale] of SCALES) {
    for (const [key, value] of Object.entries(scale)) {
      add(`${group}/${key.replace(".", "_")}`, "FLOAT", () => value);
    }
  }

  return {
    meta: {
      variableCollections: {
        [COLLECTION]: {
          id: COLLECTION,
          name: "Tokens",
          modes: MODES.map(({ modeId, name }) => ({ modeId, name })),
          defaultModeId: MODES[0].modeId,
          variableIds: Object.keys(variables),
        },
      },
      variables,
    },
  };
}
