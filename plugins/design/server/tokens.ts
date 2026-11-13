// W3C design tokens (https://design-tokens.github.io/community-group/format/) <-> FigCraft's
// local-variables JSON (the Figma REST shape FigCraft reads and writes; see the Task 1 fixtures).
// One collection "Tokens", one mode "Default". Composite types stay in the file, not imported.

export type TokenFile = Record<string, unknown>;

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}
interface Alias {
  type: "VARIABLE_ALIAS";
  id: string;
}
type FigValue = Rgba | number | string | boolean | Alias;

export interface FigVariable {
  id: string;
  name: string;
  variableCollectionId: string;
  resolvedType: "COLOR" | "FLOAT" | "STRING" | "BOOLEAN";
  valuesByMode: Record<string, FigValue>;
}

export interface FigVariablesJson {
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
    variables: Record<string, FigVariable>;
  };
}

export class TokensError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokensError";
  }
}

const COLLECTION = "c:tokens";
const MODE = "m:default";
const COMPOSITE = new Set([
  "shadow",
  "typography",
  "border",
  "transition",
  "gradient",
  "strokeStyle",
  "cubicBezier",
]);
const ALIAS = /^\{([^{}]+)\}$/;

interface Leaf {
  path: string[];
  type: string;
  value: unknown;
}

function isGroup(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function leaves(
  node: Record<string, unknown>,
  path: string[],
  inherited: string | undefined,
  out: Leaf[],
): void {
  const type = typeof node.$type === "string" ? node.$type : inherited;
  if ("$value" in node) {
    if (!type) throw new TokensError(`${path.join(".")}: no $type on the token or its groups`);
    out.push({ path, type, value: node.$value });
    return;
  }
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith("$") || !isGroup(child)) continue;
    leaves(child, [...path, key], type, out);
  }
}

function hexToRgba(hex: string, where: string): Rgba {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(hex.trim());
  if (!match) throw new TokensError(`${where}: colour ${hex} is not #rgb, #rrggbb or #rrggbbaa`);
  let digits = match[1];
  if (digits.length === 3) digits = [...digits].map((c) => c + c).join("");
  const byte = (i: number) => Number.parseInt(digits.slice(i, i + 2), 16) / 255;
  return { r: byte(0), g: byte(2), b: byte(4), a: digits.length === 8 ? byte(6) : 1 };
}

function rgbaToHex({ r, g, b, a }: Rgba): string {
  const byte = (v: number) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${byte(r)}${byte(g)}${byte(b)}${a < 1 ? byte(a) : ""}`;
}

function variableId(path: string[]): string {
  return `v:${path.join("/")}`;
}

function figValue(
  leaf: Leaf,
  known: Set<string>,
): { type: FigVariable["resolvedType"]; value: FigValue } {
  const where = leaf.path.join(".");
  if (typeof leaf.value === "string") {
    const alias = ALIAS.exec(leaf.value);
    if (alias) {
      const target = alias[1].split(".");
      if (!known.has(target.join(".")))
        throw new TokensError(`${where}: alias ${leaf.value} names no token`);
      return {
        type: resolvedTypeOf(leaf.type),
        value: { type: "VARIABLE_ALIAS", id: variableId(target) },
      };
    }
  }
  switch (leaf.type) {
    case "color":
      return { type: "COLOR", value: hexToRgba(String(leaf.value), where) };
    case "dimension": {
      const match = /^(-?\d+(?:\.\d+)?)px$/.exec(String(leaf.value));
      if (!match)
        throw new TokensError(
          `${where}: only px dimensions are supported, got ${String(leaf.value)}`,
        );
      return { type: "FLOAT", value: Number(match[1]) };
    }
    case "number":
    case "fontWeight":
    case "duration":
      if (typeof leaf.value !== "number")
        throw new TokensError(`${where}: ${leaf.type} must be a number`);
      return { type: "FLOAT", value: leaf.value };
    case "fontFamily":
      return {
        type: "STRING",
        value: Array.isArray(leaf.value) ? String(leaf.value[0]) : String(leaf.value),
      };
    case "boolean":
      return { type: "BOOLEAN", value: Boolean(leaf.value) };
    default:
      return { type: "STRING", value: String(leaf.value) };
  }
}

function resolvedTypeOf(type: string): FigVariable["resolvedType"] {
  if (type === "color") return "COLOR";
  if (type === "dimension" || type === "number" || type === "fontWeight" || type === "duration")
    return "FLOAT";
  if (type === "boolean") return "BOOLEAN";
  return "STRING";
}

export function toVariables(file: TokenFile): { variables: FigVariablesJson; warnings: string[] } {
  const all: Leaf[] = [];
  leaves(file, [], undefined, all);
  const warnings: string[] = [];
  const simple = all.filter((leaf) => {
    if (!COMPOSITE.has(leaf.type)) return true;
    warnings.push(
      `${leaf.path.join(".")}: ${leaf.type} tokens stay in the file and are not imported`,
    );
    return false;
  });
  const known = new Set(simple.map((leaf) => leaf.path.join(".")));
  const variables: FigVariablesJson["meta"]["variables"] = {};
  for (const leaf of simple) {
    const { type, value } = figValue(leaf, known);
    const id = variableId(leaf.path);
    variables[id] = {
      id,
      name: leaf.path.join("/"),
      variableCollectionId: COLLECTION,
      resolvedType: type,
      valuesByMode: { [MODE]: value },
    };
  }
  return {
    warnings,
    variables: {
      meta: {
        variableCollections: {
          [COLLECTION]: {
            id: COLLECTION,
            name: "Tokens",
            modes: [{ modeId: MODE, name: "Default" }],
            defaultModeId: MODE,
            variableIds: Object.keys(variables),
          },
        },
        variables,
      },
    },
  };
}

/** The Tokens collection's variables by name, each at its default mode. */
function exportedByName(
  exported: unknown,
): Map<string, { variable: FigVariable; value: FigValue; names: Map<string, string> }> {
  const meta = (exported as Partial<FigVariablesJson>)?.meta;
  const result = new Map<
    string,
    { variable: FigVariable; value: FigValue; names: Map<string, string> }
  >();
  if (!meta) return result;
  const collection = Object.values(meta.variableCollections ?? {}).find((c) => c.name === "Tokens");
  if (!collection) return result;
  const names = new Map(Object.values(meta.variables ?? {}).map((v) => [v.id, v.name]));
  for (const variable of Object.values(meta.variables ?? {})) {
    if (variable.variableCollectionId !== collection.id) continue;
    result.set(variable.name, {
      variable,
      value: variable.valuesByMode[collection.defaultModeId],
      names,
    });
  }
  return result;
}

function tokenValue(type: string, value: FigValue, names: Map<string, string>): unknown {
  if (typeof value === "object" && value !== null && "type" in value) {
    const target = names.get(value.id);
    return target ? `{${target.split("/").join(".")}}` : undefined;
  }
  if (type === "color" && typeof value === "object") return rgbaToHex(value as Rgba);
  // FigCraft stores 32-bit floats (16.0, 0.10000000149); four decimals is what a file holds.
  const number = typeof value === "number" ? Math.round(value * 1e4) / 1e4 : value;
  if (type === "dimension" && typeof number === "number") return `${number}px`;
  return number;
}

/** A token as FigCraft would hand it back, so an unchanged token compares equal to its export. */
function canonical(leaf: Leaf): unknown {
  if (typeof leaf.value === "string" && ALIAS.test(leaf.value)) return leaf.value;
  try {
    return tokenValue(leaf.type, figValue(leaf, new Set()).value, new Map());
  } catch {
    return undefined;
  }
}

function newTokenType(variable: FigVariable): string {
  return { COLOR: "color", FLOAT: "number", STRING: "string", BOOLEAN: "boolean" }[
    variable.resolvedType
  ];
}

export function fromVariables(exported: unknown, previous: TokenFile): TokenFile {
  const next = structuredClone(previous);
  const existing: Leaf[] = [];
  leaves(previous, [], undefined, existing);
  const byName = exportedByName(exported);
  const seen = new Set<string>();
  for (const leaf of existing) {
    const name = leaf.path.join("/");
    const entry = byName.get(name);
    if (!entry || COMPOSITE.has(leaf.type)) continue;
    seen.add(name);
    const value = tokenValue(leaf.type, entry.value, entry.names);
    if (value === undefined || JSON.stringify(value) === JSON.stringify(canonical(leaf))) continue;
    let node = next as Record<string, unknown>;
    for (const key of leaf.path) node = node[key] as Record<string, unknown>;
    node.$value = value;
  }
  for (const [name, entry] of byName) {
    if (seen.has(name)) continue;
    const path = name.split("/");
    const type = newTokenType(entry.variable);
    let node = next as Record<string, unknown>;
    for (const key of path.slice(0, -1)) {
      if (!isGroup(node[key])) node[key] = {};
      node = node[key] as Record<string, unknown>;
    }
    node[path[path.length - 1]] = {
      $value: tokenValue(type, entry.value, entry.names),
      $type: type,
    };
  }
  return next;
}

export function sameTokens(file: TokenFile, exported: unknown): boolean {
  return (
    JSON.stringify(fromVariables(exported, file)) === JSON.stringify(file) &&
    exportedByName(exported).size > 0
  );
}
