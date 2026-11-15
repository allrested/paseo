// A Jupyter notebook (.ipynb, format 4) as the cells a reader sees.
import { z } from "zod";

/** A cell's text is one string or its lines. */
const TextSchema = z.union([z.string(), z.array(z.string())]);

const OutputSchema = z.looseObject({
  output_type: z.string(),
  // stream
  name: z.string().optional(),
  text: TextSchema.optional(),
  // execute_result, display_data
  data: z.record(z.string(), z.unknown()).optional(),
  // error
  ename: z.string().optional(),
  evalue: z.string().optional(),
  traceback: z.array(z.string()).optional(),
});

const CellSchema = z.looseObject({
  cell_type: z.string(),
  source: TextSchema.optional(),
  execution_count: z.number().nullable().optional(),
  outputs: z.array(OutputSchema).optional(),
});

const NotebookSchema = z.looseObject({
  nbformat: z.number(),
  cells: z.array(CellSchema),
  metadata: z
    .looseObject({
      language_info: z.looseObject({ name: z.string().optional() }).optional(),
      kernelspec: z.looseObject({ language: z.string().optional() }).optional(),
    })
    .optional(),
});

export type NotebookOutput =
  /** Printed text, or a result's plain text. `more` counts the characters left out. */
  | { kind: "text"; stream: "stdout" | "stderr" | "result"; text: string; more: number }
  | { kind: "markdown"; text: string }
  /** `data` is base64. */
  | { kind: "image"; mime: "image/png" | "image/jpeg"; data: string }
  | { kind: "error"; text: string }
  /** An output in types this viewer does not draw. */
  | { kind: "other"; types: string[] };

export type NotebookCell =
  | { kind: "markdown"; source: string }
  | { kind: "code"; source: string; count: number | null; outputs: NotebookOutput[] }
  | { kind: "raw"; source: string };

export interface Notebook {
  /** The language of the code cells, for highlighting; "" when the file does not say. */
  language: string;
  cells: NotebookCell[];
}

export type NotebookRead = { ok: true; notebook: Notebook } | { ok: false; reason: string };

/** One output's text is cut here: a loop that printed for an hour is megabytes. */
export const OUTPUT_MAX = 20_000;

const joined = (text: string | string[] | undefined): string =>
  typeof text === "string" ? text : (text ?? []).join("");

/** A terminal's colour codes, which a traceback is full of. */
// oxlint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

function cut(text: string): { text: string; more: number } {
  if (text.length <= OUTPUT_MAX) return { text, more: 0 };
  return { text: text.slice(0, OUTPUT_MAX), more: text.length - OUTPUT_MAX };
}

function textOf(value: unknown): string | null {
  const parsed = TextSchema.safeParse(value);
  return parsed.success ? joined(parsed.data) : null;
}

const IMAGES = ["image/png", "image/jpeg"] as const;

/** What a result shows: its picture, else its Markdown, else its plain text. */
function display(data: Record<string, unknown>): NotebookOutput {
  for (const mime of IMAGES) {
    const image = textOf(data[mime]);
    if (image !== null) return { kind: "image", mime, data: image.replace(/\s+/g, "") };
  }
  const markdown = textOf(data["text/markdown"]);
  if (markdown !== null) return { kind: "markdown", text: markdown };
  const plain = textOf(data["text/plain"]);
  if (plain !== null) return { kind: "text", stream: "result", ...cut(plain.replace(ANSI, "")) };
  return { kind: "other", types: Object.keys(data) };
}

function output(raw: z.output<typeof OutputSchema>): NotebookOutput {
  if (raw.output_type === "stream") {
    const stream = raw.name === "stderr" ? "stderr" : "stdout";
    return { kind: "text", stream, ...cut(joined(raw.text).replace(ANSI, "")) };
  }
  if (raw.output_type === "error") {
    const trace = (raw.traceback ?? []).join("\n").replace(ANSI, "");
    const named = [raw.ename, raw.evalue].filter(Boolean).join(": ");
    return { kind: "error", text: cut(trace === "" ? named : trace).text };
  }
  if (raw.data !== undefined) return display(raw.data);
  return { kind: "other", types: [raw.output_type] };
}

function cell(raw: z.output<typeof CellSchema>): NotebookCell {
  const source = joined(raw.source);
  if (raw.cell_type === "markdown") return { kind: "markdown", source };
  if (raw.cell_type !== "code") return { kind: "raw", source };
  return {
    kind: "code",
    source,
    count: raw.execution_count ?? null,
    outputs: (raw.outputs ?? []).map(output),
  };
}

/** Reads a notebook file's text. `reason` says why a file is not shown. */
export function readNotebook(text: string): NotebookRead {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: "This file is not a notebook: it is not JSON." };
  }
  const format = z.looseObject({ nbformat: z.number() }).safeParse(value);
  if (format.success && format.data.nbformat < 4) {
    return {
      ok: false,
      reason: `This notebook is in format ${format.data.nbformat}. Paseo shows format 4 and later.`,
    };
  }
  const parsed = NotebookSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, reason: "This file is not a notebook Paseo can read." };
  }
  const { metadata, cells } = parsed.data;
  return {
    ok: true,
    notebook: {
      language: metadata?.language_info?.name ?? metadata?.kernelspec?.language ?? "",
      cells: cells.map(cell),
    },
  };
}

/**
 * Code as a Markdown code block, so the host's renderer highlights it. The fence is longer than
 * any run of backticks in the code.
 */
export function fenced(source: string, language: string): string {
  const longest = (source.match(/`+/g) ?? []).reduce((most, run) => Math.max(most, run.length), 0);
  const fence = "`".repeat(Math.max(3, longest + 1));
  // A language is one word: anything else would end the fence's first line early.
  const word = /^[\w+#.-]+$/.test(language) ? language : "";
  return `${fence}${word}\n${source}\n${fence}`;
}
