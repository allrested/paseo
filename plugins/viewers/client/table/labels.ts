// The table's words.
import { counted } from "../reading.js";
import type { Direction } from "./order.js";

/** "1,204 rows", or "37 of 1,204 rows" under a search. */
export function rowCount(shown: number, total: number): string {
  const rows = `${counted(total)} ${total === 1 ? "row" : "rows"}`;
  return shown === total ? rows : `${counted(shown)} of ${rows}`;
}

/** A column's name read aloud: how it is sorted, and what a press does next. */
export function sortLabel(name: string, direction: Direction | null): string {
  if (direction === null) return `Sort by ${name}`;
  if (direction === "ascending") return `${name}, sorted ascending. Sort descending`;
  return `${name}, sorted descending. Back to the file's order`;
}

/** The mark beside a column's name. */
export function sortIcon(direction: Direction | null): string {
  if (direction === null) return "ChevronsUpDown";
  return direction === "ascending" ? "ArrowUp" : "ArrowDown";
}
