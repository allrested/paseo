// Delimited text (CSV, TSV) as records of cells, after RFC 4180: a quoted cell may hold the
// delimiter, a line end, and a quote written twice.

export type Delimiter = "," | ";" | "\t";

const QUOTE = 34;
const LF = 10;
const CR = 13;

const CANDIDATES: readonly Delimiter[] = [",", ";", "\t"];

/** The file's first line, as far as it is outside quotes. */
function firstLine(text: string): string {
  let quoted = false;
  for (let at = 0; at < text.length; at += 1) {
    const code = text.charCodeAt(at);
    if (code === QUOTE) quoted = !quoted;
    else if (!quoted && (code === LF || code === CR)) return text.slice(0, at);
  }
  return text;
}

function count(line: string, delimiter: Delimiter): number {
  let quoted = false;
  let found = 0;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === delimiter) found += 1;
  }
  return found;
}

/**
 * A .tsv is split at tabs. Any other file is split at what its first line holds most of: a
 * spreadsheet set to a comma decimal writes ";" into a .csv.
 */
export function delimiterOf(extension: string, text: string): Delimiter {
  if (extension === "tsv" || extension === "tab") return "\t";
  const line = firstLine(text);
  let best: Delimiter = ",";
  let most = 0;
  for (const candidate of CANDIDATES) {
    const found = count(line, candidate);
    if (found > most) {
      best = candidate;
      most = found;
    }
  }
  return best;
}

/** The records of a delimited text. A blank line is no record. */
export function parseDelimited(text: string, delimiter: Delimiter): string[][] {
  const split = delimiter.charCodeAt(0);
  const { length } = text;
  const records: string[][] = [];
  let record: string[] = [];
  let at = 0;
  // After a delimiter a cell is owed, even where the text ends.
  let owed = false;
  const endOfCell = (from: number): number => {
    let end = from;
    while (end < length) {
      const code = text.charCodeAt(end);
      if (code === split || code === LF || code === CR) break;
      end += 1;
    }
    return end;
  };
  const close = () => {
    // A line with nothing on it parses as one empty cell.
    if (record.length > 1 || record[0] !== "") records.push(record);
    record = [];
  };
  while (at < length) {
    let cell = "";
    if (text.charCodeAt(at) === QUOTE) {
      let from = at + 1;
      for (;;) {
        const quote = text.indexOf('"', from);
        if (quote === -1) {
          // A quote that never closes takes the rest of the file.
          cell += text.slice(from);
          at = length;
          break;
        }
        if (text.charCodeAt(quote + 1) === QUOTE) {
          cell += text.slice(from, quote + 1);
          from = quote + 2;
          continue;
        }
        cell += text.slice(from, quote);
        at = quote + 1;
        break;
      }
    }
    // What follows a closing quote, up to the delimiter, is kept as written.
    const end = endOfCell(at);
    cell += text.slice(at, end);
    at = end;
    record.push(cell);
    owed = false;
    if (at >= length) break;
    const code = text.charCodeAt(at);
    if (code === split) {
      at += 1;
      owed = true;
      continue;
    }
    at += code === CR && text.charCodeAt(at + 1) === LF ? 2 : 1;
    close();
  }
  if (owed) record.push("");
  if (record.length > 0) close();
  return records;
}

export interface Table {
  /** One name per column of the widest record. */
  columns: string[];
  /** The records after the first, each as wide as the columns. */
  rows: string[][];
}

/** The first record names the columns; a column it does not name is "Column N". */
export function toTable(records: readonly string[][]): Table {
  const width = records.reduce((most, record) => Math.max(most, record.length), 0);
  const [header = [], ...rest] = records;
  const columns = Array.from({ length: width }, (_, index) => {
    const name = (header[index] ?? "").trim();
    return name === "" ? `Column ${index + 1}` : name;
  });
  const rows = rest.map((record) =>
    record.length === width
      ? record
      : record.concat(Array.from({ length: width - record.length }, () => "")),
  );
  return { columns, rows };
}

/** A file's text as a table. */
export function readTable(extension: string, text: string): Table {
  return toTable(parseDelimited(text, delimiterOf(extension, text)));
}
