// Which rows of a table show, and in what order.
import type { Table } from "./parse.js";

export type Direction = "ascending" | "descending";

export interface Sort {
  column: number;
  direction: Direction;
}

function numberIn(cell: string): number | null {
  const text = cell.trim();
  if (text === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** Per column: true when every cell that holds something is a number, and one does. */
export function numericColumns(table: Table): boolean[] {
  return table.columns.map((_, column) => {
    let some = false;
    for (const row of table.rows) {
      if (row[column].trim() === "") continue;
      if (numberIn(row[column]) === null) return false;
      some = true;
    }
    return some;
  });
}

/** The words of a search: lower case, split at spaces. */
export function searchWords(text: string): string[] {
  return text.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Each row as one lower-case text, to search in. */
export function searchable(table: Table): string[] {
  return table.rows.map((row) => row.join("\u0000").toLowerCase());
}

/** The next sort after a press on a column's name: ascending, descending, the file's order. */
export function nextSort(sort: Sort | null, column: number): Sort | null {
  if (sort?.column !== column) return { column, direction: "ascending" };
  return sort.direction === "ascending" ? { column, direction: "descending" } : null;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export interface Arrangement {
  /** A search's words; a row shows when it holds every one. */
  words: readonly string[];
  /** `searchable(table)`; read only when there are words. */
  texts: readonly string[];
  sort: Sort | null;
  /** `numericColumns(table)`. */
  numeric: readonly boolean[];
}

/**
 * The indexes of the rows that show, in the order they show. An empty cell sorts last in both
 * directions, and rows that compare equal keep the file's order.
 */
export function arrange(table: Table, { words, texts, sort, numeric }: Arrangement): number[] {
  const shown: number[] = [];
  for (let index = 0; index < table.rows.length; index += 1) {
    if (words.every((word) => texts[index].includes(word))) shown.push(index);
  }
  if (sort === null) return shown;
  const { column } = sort;
  const sign = sort.direction === "ascending" ? 1 : -1;
  const cell = (index: number) => table.rows[index][column];
  const compare = numeric[column]
    ? (a: number, b: number) => (numberIn(cell(a)) ?? 0) - (numberIn(cell(b)) ?? 0)
    : (a: number, b: number) => collator.compare(cell(a), cell(b));
  return shown.sort((a, b) => {
    const emptyA = cell(a).trim() === "";
    const emptyB = cell(b).trim() === "";
    if (emptyA || emptyB) return Number(emptyA) - Number(emptyB);
    return sign * compare(a, b);
  });
}
