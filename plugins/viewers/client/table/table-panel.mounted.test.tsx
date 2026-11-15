/**
 * @vitest-environment jsdom
 */
// The table panel, mounted. The list, the scroll view and the field are the host's, so
// react-native's own stand in; the file is the test's.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { TABLE_MAX_BYTES } from "../reading.js";
import { fakeFile, panelProps, pendingFile, type FakeFile } from "../testing.js";
import { TablePanel } from "./table-panel.js";

vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { FlatList, ScrollView, TextInput, View } = await import("react-native");
  const { createElement } = await import("react");
  return {
    FlatList,
    ScrollView,
    TextInput,
    Icon: ({ name }: { name: string }) => createElement(View, { testID: `icon-${name}` }),
    Loading: () => createElement(View, { testID: "loading" }),
  };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const FRUIT = [
  "name,price,note",
  "Pear,10,ripe",
  "apple,9.5,",
  'Fig,,"Dried, sweet"',
  "Kiwi,-3,ripe",
].join("\n");

let container: HTMLElement;
let root: Root;

const settle = () => act(async () => void (await new Promise((done) => setTimeout(done, 0))));

async function mount(file: FakeFile): Promise<void> {
  await act(async () => root.render(<TablePanel {...panelProps(file)} />));
  await settle();
}

const buttons = () => [...container.querySelectorAll<HTMLElement>('[role="button"]')];
/** The rows on screen, each as its cells; the first cell is the row's number in the file. */
const rows = () =>
  buttons()
    .filter((each) => each.hasAttribute("aria-expanded"))
    .map((row) => [...row.children].map((cell) => cell.textContent));
const names = () => rows().map((cells) => cells[1]);
const heads = () =>
  buttons()
    .filter((each) => !each.hasAttribute("aria-expanded"))
    .map((each) => each.getAttribute("aria-label"));
const head = (label: string) => {
  const found = buttons().find((each) => each.getAttribute("aria-label") === label);
  if (!found) throw new Error(`No column "${label}"`);
  return found;
};
const press = (label: string) => act(async () => head(label).click());
const search = () => container.querySelector<HTMLInputElement>('[aria-label="Search the table"]');

async function type(value: string): Promise<void> {
  const field = search();
  if (!field) throw new Error("No search field");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test("until the file is read the panel shows the host's loading state", async () => {
  await mount(pendingFile("fruit.csv"));

  expect(container.querySelector('[data-testid="loading"]')).not.toBeNull();
});

test("the first line names the columns, and the rest are numbered rows", async () => {
  await mount(fakeFile("fruit.csv", FRUIT));

  expect(heads()).toEqual(["Sort by name", "Sort by price", "Sort by note"]);
  expect(rows()).toEqual([
    ["1", "Pear", "10", "ripe"],
    ["2", "apple", "9.5", ""],
    ["3", "Fig", "", "Dried, sweet"],
    ["4", "Kiwi", "-3", "ripe"],
  ]);
  expect(container.textContent).toContain("4 rows");
});

test("a .tsv is split at its tabs", async () => {
  await mount(fakeFile("fruit.tsv", "name\tnote\nPear\tripe, soft\n"));

  expect(rows()).toEqual([["1", "Pear", "ripe, soft"]]);
});

test("a press on a column's name sorts by it: up, down, then the file's order", async () => {
  await mount(fakeFile("fruit.csv", FRUIT));

  await press("Sort by price");
  // By value, and the row without a price last; a row keeps its number in the file.
  expect(rows().map((cells) => cells[0])).toEqual(["4", "2", "1", "3"]);
  expect(head("price, sorted ascending. Sort descending")).toBeDefined();
  expect(container.querySelectorAll('[data-testid="icon-ArrowUp"]')).toHaveLength(1);

  await press("price, sorted ascending. Sort descending");
  expect(names()).toEqual(["Pear", "apple", "Kiwi", "Fig"]);

  await press("price, sorted descending. Back to the file's order");
  expect(names()).toEqual(["Pear", "apple", "Fig", "Kiwi"]);
  expect(heads()).toContain("Sort by price");
});

test("sorting another column leaves the first", async () => {
  await mount(fakeFile("fruit.csv", FRUIT));
  await press("Sort by price");

  await press("Sort by name");

  expect(names()).toEqual(["apple", "Fig", "Kiwi", "Pear"]);
  expect(heads()).toEqual([
    "name, sorted ascending. Sort descending",
    "Sort by price",
    "Sort by note",
  ]);
});

test("the search keeps the rows that hold every word, and the count says how many", async () => {
  await mount(fakeFile("fruit.csv", FRUIT));

  await type("RIPE");
  expect(names()).toEqual(["Pear", "Kiwi"]);
  expect(container.textContent).toContain("2 of 4 rows");

  await type("ripe kiwi");
  expect(names()).toEqual(["Kiwi"]);

  await type("");
  expect(names()).toHaveLength(4);
});

test("a search that finds nothing says so, under the column names", async () => {
  await mount(fakeFile("fruit.csv", FRUIT));

  await type("plum");

  expect(rows()).toEqual([]);
  expect(container.textContent).toContain('No rows match "plum"');
  expect(heads()).toHaveLength(3);
});

test("a searched table sorts too", async () => {
  await mount(fakeFile("fruit.csv", FRUIT));
  await type("ripe");

  await press("Sort by price");

  expect(names()).toEqual(["Kiwi", "Pear"]);
});

test("pressing a row shows it in full, and pressing another moves that", async () => {
  await mount(fakeFile("fruit.csv", FRUIT));
  const row = (index: number) =>
    buttons().filter((each) => each.hasAttribute("aria-expanded"))[index];
  expect(row(0).getAttribute("aria-expanded")).toBe("false");

  await act(async () => row(0).click());
  expect(row(0).getAttribute("aria-expanded")).toBe("true");

  await act(async () => row(2).click());
  expect(row(0).getAttribute("aria-expanded")).toBe("false");
  expect(row(2).getAttribute("aria-expanded")).toBe("true");

  await act(async () => row(2).click());
  expect(row(2).getAttribute("aria-expanded")).toBe("false");
});

test("a file with only its column names shows them and says there are no rows", async () => {
  await mount(fakeFile("fruit.csv", "name,price\n"));

  expect(heads()).toEqual(["Sort by name", "Sort by price"]);
  expect(container.textContent).toContain("The file names its columns and has no rows.");
  expect(container.textContent).toContain("0 rows");
});

test("an empty file says so", async () => {
  await mount(fakeFile("fruit.csv", "\n"));

  expect(container.textContent).toBe("This file is empty.");
});

test("a file over the limit is not read", async () => {
  const file = fakeFile("huge.csv", FRUIT, { size: TABLE_MAX_BYTES + 1 });
  await mount(file);

  expect(container.textContent).toContain("a table is shown up to 10.0 MB");
  expect(file.reads).toBe(0);
});

test("a file that cannot be read says why", async () => {
  await mount(fakeFile("fruit.csv", new Error("offline")));

  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "Unable to read the file: offline",
  );
});

test("a file written again shows its new rows and keeps the sort", async () => {
  const file = fakeFile("fruit.csv", FRUIT);
  await mount(file);
  await press("Sort by price");

  await act(async () => file.change("name,price\nPlum,7\nLime,2\n"));
  await settle();

  expect(names()).toEqual(["Lime", "Plum"]);
  // A file that lost the sorted column is in its own order.
  await act(async () => file.change("name\nPlum\nLime\n"));
  await settle();
  expect(names()).toEqual(["Plum", "Lime"]);
});

test("a file deleted under the tab says so", async () => {
  const file = fakeFile("fruit.csv", FRUIT);
  await mount(file);

  await act(async () => file.remove());

  expect(container.querySelector('[role="alert"]')?.textContent).toBe("This file was deleted.");
});
