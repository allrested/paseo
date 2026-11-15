/**
 * @vitest-environment jsdom
 */
// The notebook panel, mounted. The list and the Markdown renderer are the host's: react-native's
// list stands in, and Markdown is shown as the text it was given.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Image } from "react-native";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { NOTEBOOK_MAX_BYTES } from "../reading.js";
import { fakeFile, panelProps, pendingFile, type FakeFile } from "../testing.js";
import { NotebookPanel } from "./notebook-panel.js";

vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { FlatList, View } = await import("react-native");
  const { createElement } = await import("react");
  return {
    FlatList,
    Loading: () => createElement(View, { testID: "loading" }),
    Markdown: ({ children }: { children: string }) =>
      createElement("div", { "data-markdown": "" }, children),
  };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const notebook = (cells: unknown[], language = "python") =>
  JSON.stringify({
    nbformat: 4,
    nbformat_minor: 5,
    metadata: { language_info: { name: language } },
    cells,
  });

const code = (source: string, outputs: unknown[] = [], count: number | null = 1) => ({
  cell_type: "code",
  metadata: {},
  source,
  execution_count: count,
  outputs,
});

let container: HTMLElement;
let root: Root;

const settle = () => act(async () => void (await new Promise((done) => setTimeout(done, 0))));

async function mount(file: FakeFile): Promise<void> {
  await act(async () => root.render(<NotebookPanel {...panelProps(file)} />));
  await settle();
}

const markdown = () =>
  [...container.querySelectorAll("[data-markdown]")].map((each) => each.textContent);

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

test("until the file is read the panel shows the host's loading state", async () => {
  await mount(pendingFile("sales.ipynb"));

  expect(container.querySelector('[data-testid="loading"]')).not.toBeNull();
});

test("text cells are Markdown, and code is a highlighted block with its run number", async () => {
  await mount(
    fakeFile(
      "sales.ipynb",
      notebook([
        { cell_type: "markdown", metadata: {}, source: ["# Sales\n", "By month."] },
        code("total = 1 + 1", [], 7),
        code("later()", [], null),
        { cell_type: "raw", metadata: {}, source: "kept as written" },
      ]),
    ),
  );

  expect(markdown()).toEqual([
    "# Sales\nBy month.",
    "```python\ntotal = 1 + 1\n```",
    "```python\nlater()\n```",
  ]);
  expect(container.textContent).toContain("[7]");
  expect(container.textContent).toContain("[ ]");
  expect(container.textContent).toContain("kept as written");
});

test("what the code printed is under it, and stderr is named", async () => {
  await mount(
    fakeFile(
      "sales.ipynb",
      notebook([
        code("run()", [
          { output_type: "stream", name: "stdout", text: "first line\n" },
          { output_type: "stream", name: "stderr", text: "careful\n" },
          { output_type: "execute_result", data: { "text/plain": "42" }, execution_count: 1 },
          { output_type: "execute_result", data: { "text/markdown": "**bold**" } },
          { output_type: "display_data", data: { "text/html": "<b>x</b>" } },
        ]),
      ]),
    ),
  );

  const text = container.textContent ?? "";
  expect(text).toContain("first line");
  expect(text).toContain("stderrcareful");
  expect(text).toContain("42");
  expect(markdown()).toContain("**bold**");
  expect(text).toContain("An output that is not shown here (text/html)");
});

test("an error shows its traceback", async () => {
  await mount(
    fakeFile(
      "sales.ipynb",
      notebook([
        code("1 / 0", [
          {
            output_type: "error",
            ename: "ZeroDivisionError",
            evalue: "division by zero",
            traceback: ["\u001b[31mZeroDivisionError\u001b[0m: division by zero"],
          },
        ]),
      ]),
    ),
  );

  expect(container.textContent).toContain("ZeroDivisionError: division by zero");
  expect(container.textContent).not.toContain("[31m");
});

test("a long output is cut and says how much is left", async () => {
  await mount(
    fakeFile(
      "sales.ipynb",
      notebook([
        code("loop()", [{ output_type: "stream", name: "stdout", text: "x".repeat(20_012) }]),
      ]),
    ),
  );

  expect(container.textContent).toContain("12 more characters in the file");
});

test("a plot is drawn at its own shape, from the bytes in the file", async () => {
  vi.spyOn(Image, "getSize").mockImplementation((_uri, success) => success(640, 320));
  await mount(
    fakeFile(
      "sales.ipynb",
      notebook([
        code("plot()", [
          {
            output_type: "display_data",
            data: { "image/png": "iVBOR\nw0KGgo=", "text/plain": "<Figure>" },
          },
        ]),
      ]),
    ),
  );

  const picture = container.querySelector('[role="img"]');
  expect(picture?.getAttribute("aria-label")).toBe("Picture output");
  expect(container.innerHTML).toContain("data:image/png;base64,iVBORw0KGgo=");
  expect(container.textContent).not.toContain("<Figure>");
});

test("a picture that cannot be drawn says so", async () => {
  vi.spyOn(Image, "getSize").mockImplementation((_uri, _success, failed) =>
    failed?.(new Error("bad image")),
  );
  await mount(
    fakeFile(
      "sales.ipynb",
      notebook([code("plot()", [{ output_type: "display_data", data: { "image/png": "AAAA" } }])]),
    ),
  );

  expect(container.querySelector('[role="img"]')).toBeNull();
  expect(container.textContent).toContain("A picture that cannot be drawn here");
});

test("a notebook without cells, and a file that is no notebook, say so", async () => {
  await mount(fakeFile("empty.ipynb", notebook([])));
  expect(container.textContent).toBe("This notebook has no cells.");

  await mount(fakeFile("broken.ipynb", "{"));
  expect(container.textContent).toBe("This file is not a notebook: it is not JSON.");
});

test("a file over the limit is not read", async () => {
  const file = fakeFile("huge.ipynb", notebook([]), { size: NOTEBOOK_MAX_BYTES + 1 });
  await mount(file);

  expect(container.textContent).toContain("a notebook is shown up to 20.0 MB");
  expect(file.reads).toBe(0);
});

test("a file that cannot be read says why, and a notebook saved again shows its new cells", async () => {
  await mount(fakeFile("sales.ipynb", new Error("offline")));
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "Unable to read the file: offline",
  );

  const file = fakeFile("sales.ipynb", notebook([code("one()")]));
  await mount(file);
  await act(async () => file.change(notebook([code("two()")], "r")));
  await settle();
  expect(markdown()).toEqual(["```r\ntwo()\n```"]);
});
