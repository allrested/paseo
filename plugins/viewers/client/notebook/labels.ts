// The notebook's words.
import { counted } from "../reading.js";
import type { NotebookOutput } from "./notebook.js";

/** "[3]": the run a code cell's output is from; "[ ]" for a cell that was not run. */
export function runLabel(count: number | null): string {
  return count === null ? "[ ]" : `[${count}]`;
}

/** What follows an output that was cut. */
export function moreLabel(more: number): string {
  return `${counted(more)} more ${more === 1 ? "character" : "characters"} in the file`;
}

/** An output this viewer does not draw, by its types. */
export function otherLabel(output: Extract<NotebookOutput, { kind: "other" }>): string {
  return `An output that is not shown here (${output.types.join(", ")})`;
}
