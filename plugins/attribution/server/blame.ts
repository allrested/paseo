/** What `git blame --porcelain` says of one commit. */
export interface BlameCommit {
  author: string;
  /** Seconds since the epoch. */
  time: number;
  summary: string;
}

export interface Blame {
  /** Each line of the file, in order, with the commit that last wrote it. */
  lines: Array<{ commit: string; text: string }>;
  commits: Map<string, BlameCommit>;
}

const GROUP = /^([0-9a-f]{40,64}) \d+ \d+(?: \d+)?$/;

/**
 * Reads `git blame --porcelain`: a line "<commit> <from> <to> [<count>]", the commit's headers
 * the first time it shows, then the file's line after a tab.
 */
export function parseBlame(output: string): Blame {
  const lines: Blame["lines"] = [];
  const commits = new Map<string, BlameCommit>();
  let current = "";
  for (const row of output.split("\n")) {
    if (row.startsWith("\t")) {
      lines.push({ commit: current, text: row.slice(1) });
      continue;
    }
    const group = GROUP.exec(row);
    if (group) {
      current = group[1] ?? "";
      if (!commits.has(current)) commits.set(current, { author: "", time: 0, summary: "" });
      continue;
    }
    const commit = commits.get(current);
    if (!commit) continue;
    const space = row.indexOf(" ");
    const key = space === -1 ? row : row.slice(0, space);
    const value = space === -1 ? "" : row.slice(space + 1);
    if (key === "author") commit.author = value;
    else if (key === "author-time") commit.time = Number(value) || 0;
    else if (key === "summary") commit.summary = value;
  }
  return { lines, commits };
}
