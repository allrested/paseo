// How wide a table's columns are drawn. React Native lays out no table, so each column gets a
// width from what it holds.
import type { Table } from "./parse.js";

/** A wide character of the cell font (a digit), and a cell's padding on both sides. */
const CHARACTER = 8;
/** The names are set heavier than the cells. */
const NAME_CHARACTER = 8.5;
const PADDING = 24;
/** The sort mark beside a column's name, with its gap. */
const SORT_MARK = 22;
const NARROWEST = 4;
const WIDEST = 40;
/** The rows measured: enough to size a column, few enough for a file of any length. */
const SAMPLE = 200;

/** A cell's length as drawn on one line: its first. */
function drawn(cell: string): number {
  const end = cell.indexOf("\n");
  return end === -1 ? cell.length : end;
}

/** Each column's width, from its name and its first rows; a long cell is cut at the widest. */
export function columnWidths(table: Table): number[] {
  const rows = table.rows.slice(0, SAMPLE);
  return table.columns.map((name, column) => {
    let longest = NARROWEST;
    for (const row of rows) longest = Math.max(longest, drawn(row[column]));
    const cells = Math.round(Math.min(WIDEST, longest) * CHARACTER) + PADDING;
    const head = Math.round(Math.min(WIDEST, name.length) * NAME_CHARACTER) + PADDING + SORT_MARK;
    return Math.max(cells, head);
  });
}

/** The width of the column that numbers the rows: the last number, and half a digit to spare. */
export function numberWidth(rows: number): number {
  return Math.round((Math.max(2, String(rows).length) + 0.5) * CHARACTER) + PADDING;
}
