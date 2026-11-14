// What the phone's edit sheet shows of a layer, made from FigCraft's answers.
import type { ColorToken, Layer, LayerRef } from "../shared/contracts.js";
import type { Bounds, RawLayer } from "./figcraft-session.js";

/** The most layers a pick lists under one spot. */
export const MAX_HERE = 10;

interface ExportedVariable {
  id: string;
  name: string;
  variableCollectionId: string;
  resolvedType: string;
  valuesByMode: Record<string, unknown>;
}

interface ExportedMeta {
  variableCollections?: Record<string, { defaultModeId?: string }>;
  variables?: Record<string, ExportedVariable>;
}

function channel(value: unknown): string {
  const n = Math.round(Math.min(1, Math.max(0, Number(value))) * 255);
  return n.toString(16).padStart(2, "0").toUpperCase();
}

function hexOf(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("r" in value)) return null;
  const { r, g, b } = value as { r: unknown; g: unknown; b: unknown };
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** The file's colour variables in their collection's default mode, aliases followed once. */
export function colorTokens(exported: unknown): ColorToken[] {
  const meta = ((exported as { meta?: ExportedMeta }).meta ?? {}) as ExportedMeta;
  const collections = meta.variableCollections ?? {};
  const variables = meta.variables ?? {};
  const valueOf = (variable: ExportedVariable): unknown =>
    variable.valuesByMode[collections[variable.variableCollectionId]?.defaultModeId ?? ""];
  return Object.values(variables)
    .filter((variable) => variable.resolvedType === "COLOR")
    .map((variable) => {
      let value = valueOf(variable);
      const alias = value as { type?: unknown; id?: unknown } | undefined;
      if (alias?.type === "VARIABLE_ALIAS") {
        const target = variables[String(alias.id)];
        value = target ? valueOf(target) : null;
      }
      return { name: variable.name, hex: hexOf(value) };
    });
}

/**
 * The sheet wants the front-most layer first. FigCraft lists a parent before its children and
 * siblings front-most first, so the deepest come first, in FigCraft's order otherwise.
 */
export function frontFirst(layers: (LayerRef & { depth: number })[]): LayerRef[] {
  return layers
    .toSorted((a, b) => b.depth - a.depth)
    .slice(0, MAX_HERE)
    .map(({ id, name, type }) => ({ id, name, type }));
}

function fillToken(raw: RawLayer, names: ReadonlyMap<string, string>): string | null {
  const bound = (raw.boundVariables as { fill?: unknown } | undefined)?.fill;
  return typeof bound === "string" ? (names.get(bound) ?? null) : null;
}

export function layerView(
  id: string,
  raw: RawLayer,
  page: Bounds | null,
  names: ReadonlyMap<string, string>,
): Layer {
  const type = String(raw.type ?? "");
  const solid = raw.fills?.find((fill) => fill.type === "solid" && typeof fill.color === "string");
  const at = raw.absoluteBounds;
  const box =
    at && page && page.width > 0 && page.height > 0
      ? {
          x: (at.x - page.x) / page.width,
          y: (at.y - page.y) / page.height,
          width: at.width / page.width,
          height: at.height / page.height,
        }
      : { x: 0, y: 0, width: 0, height: 0 };
  return {
    id,
    name: String(raw.name ?? ""),
    type,
    width: Number(raw.width ?? 0),
    height: Number(raw.height ?? 0),
    text: type === "TEXT" ? String(raw.characters ?? "") : null,
    fill: {
      token: fillToken(raw, names),
      color: solid ? String(solid.color) : null,
    },
    box,
  };
}
