import { expect, test } from "vitest";
import { OUTPUT_MAX, fenced, readNotebook, type Notebook } from "./notebook.js";

function read(value: unknown): Notebook {
  const result = readNotebook(JSON.stringify(value));
  if (!result.ok) throw new Error(result.reason);
  return result.notebook;
}

const book = (cells: unknown[], metadata: unknown = {}) => ({
  nbformat: 4,
  nbformat_minor: 5,
  metadata,
  cells,
});

test("cells keep their kind, and a source in lines is one text", () => {
  const notebook = read(
    book(
      [
        { cell_type: "markdown", metadata: {}, source: ["# Sales\n", "By month."] },
        { cell_type: "code", metadata: {}, source: "1 + 1", execution_count: 3, outputs: [] },
        { cell_type: "code", metadata: {}, source: ["x = 1\n"], execution_count: null },
        { cell_type: "raw", metadata: {}, source: "left as is" },
      ],
      { language_info: { name: "python" }, kernelspec: { language: "py" } },
    ),
  );

  expect(notebook).toEqual({
    language: "python",
    cells: [
      { kind: "markdown", source: "# Sales\nBy month." },
      { kind: "code", source: "1 + 1", count: 3, outputs: [] },
      { kind: "code", source: "x = 1\n", count: null, outputs: [] },
      { kind: "raw", source: "left as is" },
    ],
  });
});

test("the language comes from the kernel when the file names no other, and may be absent", () => {
  expect(read(book([], { kernelspec: { language: "julia" } })).language).toBe("julia");
  expect(read(book([])).language).toBe("");
  expect(read({ nbformat: 4, cells: [] }).language).toBe("");
});

const outputsOf = (outputs: unknown[]) => {
  const [cell] = read(book([{ cell_type: "code", source: "", outputs }])).cells;
  if (cell.kind !== "code") throw new Error("not a code cell");
  return cell.outputs;
};

test("printed text is shown by stream, without a terminal's colour codes", () => {
  expect(
    outputsOf([
      { output_type: "stream", name: "stdout", text: ["one\n", "two\n"] },
      { output_type: "stream", name: "stderr", text: "\u001b[31mwarn\u001b[0m\n" },
    ]),
  ).toEqual([
    { kind: "text", stream: "stdout", text: "one\ntwo\n", more: 0 },
    { kind: "text", stream: "stderr", text: "warn\n", more: 0 },
  ]);
});

test("a result shows its picture first, then its Markdown, then its plain text", () => {
  expect(
    outputsOf([
      {
        output_type: "display_data",
        data: { "text/plain": "<Figure>", "image/png": "iVBOR\nw0KGgo=\n" },
      },
      { output_type: "execute_result", data: { "image/jpeg": ["/9j/", "4AAQ"] } },
      {
        output_type: "execute_result",
        data: { "text/plain": "x", "text/markdown": "**x**", "text/html": "<b>x</b>" },
      },
      {
        output_type: "execute_result",
        execution_count: 2,
        data: { "text/html": "<table></table>", "text/plain": ["   a\n", "0  1"] },
      },
    ]),
  ).toEqual([
    { kind: "image", mime: "image/png", data: "iVBORw0KGgo=" },
    { kind: "image", mime: "image/jpeg", data: "/9j/4AAQ" },
    { kind: "markdown", text: "**x**" },
    { kind: "text", stream: "result", text: "   a\n0  1", more: 0 },
  ]);
});

test("an output in types that are not drawn names them", () => {
  expect(
    outputsOf([
      { output_type: "display_data", data: { "text/html": "<b>x</b>", "image/svg+xml": "<svg/>" } },
      { output_type: "update_display_data" },
    ]),
  ).toEqual([
    { kind: "other", types: ["text/html", "image/svg+xml"] },
    { kind: "other", types: ["update_display_data"] },
  ]);
});

test("an error shows its traceback without colour codes, or its name when it has none", () => {
  expect(
    outputsOf([
      {
        output_type: "error",
        ename: "ZeroDivisionError",
        evalue: "division by zero",
        traceback: ["\u001b[0;31m---->\u001b[0m 1 / 0", "ZeroDivisionError: division by zero"],
      },
      { output_type: "error", ename: "KeyError", evalue: "'id'", traceback: [] },
    ]),
  ).toEqual([
    { kind: "error", text: "----> 1 / 0\nZeroDivisionError: division by zero" },
    { kind: "error", text: "KeyError: 'id'" },
  ]);
});

test("a very long output is cut, and says by how much", () => {
  const [long] = outputsOf([
    { output_type: "stream", name: "stdout", text: "x".repeat(OUTPUT_MAX + 25) },
  ]);

  expect(long).toMatchObject({ kind: "text", more: 25 });
  expect(long.kind === "text" && long.text).toHaveLength(OUTPUT_MAX);
});

test("a file that is no notebook says why", () => {
  expect(readNotebook("not json")).toEqual({
    ok: false,
    reason: "This file is not a notebook: it is not JSON.",
  });
  expect(readNotebook(JSON.stringify({ nbformat: 3, worksheets: [] }))).toEqual({
    ok: false,
    reason: "This notebook is in format 3. Paseo shows format 4 and later.",
  });
  expect(readNotebook(JSON.stringify({ cells: "none" }))).toEqual({
    ok: false,
    reason: "This file is not a notebook Paseo can read.",
  });
  expect(readNotebook("[1, 2]")).toMatchObject({ ok: false });
});

test("code becomes a fenced block that its own backticks cannot close", () => {
  expect(fenced("x = 1", "python")).toBe("```python\nx = 1\n```");
  expect(fenced('print("""\n```\n""")', "python")).toBe('````python\nprint("""\n```\n""")\n````');
  // A language that is not one word is left out.
  expect(fenced("1", "")).toBe("```\n1\n```");
  expect(fenced("1", "my lang\n# x")).toBe("```\n1\n```");
});
