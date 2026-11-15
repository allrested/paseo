import { expect, test } from "vitest";
import { parseBlame } from "./blame.js";
import { authorsOf, parseChanges } from "./record.js";

const A = "a".repeat(40);
const B = "b".repeat(40);

test("each line gets its commit, and a commit's headers are read where it first shows", () => {
  const output = [
    `${A} 1 1 1`,
    "author outside",
    "author-mail <outside@paseo.invalid>",
    "author-time 1763200000",
    "summary outside",
    "filename a.txt",
    "\tone",
    `${B} 2 2 2`,
    "author agents",
    "author-time 1763200600",
    'summary {"v":1,"agents":[]}',
    "filename a.txt",
    "\t\tindented with a tab",
    `${B} 3 3`,
    `\t${A} 9 9 9`,
    `${A} 2 4 1`,
    "\t",
    "",
  ].join("\n");

  const blame = parseBlame(output);

  expect(blame.lines).toEqual([
    { commit: A, text: "one" },
    { commit: B, text: "\tindented with a tab" },
    // A line of the file that looks like a header is still a line: it follows a tab.
    { commit: B, text: `${A} 9 9 9` },
    { commit: A, text: "" },
  ]);
  expect(blame.commits.get(A)).toEqual({ author: "outside", time: 1763200000, summary: "outside" });
  expect(blame.commits.get(B)).toEqual({
    author: "agents",
    time: 1763200600,
    summary: '{"v":1,"agents":[]}',
  });
});

test("a subject names its agents, and any other subject names none", () => {
  const agents = [{ id: "a1", title: null, provider: "claude" }];

  expect(authorsOf(JSON.stringify({ v: 1, agents }))).toEqual(agents);
  expect(authorsOf("outside")).toEqual([]);
  expect(authorsOf('{"agents":[{"id":1}]}')).toEqual([]);
});

test("a raw diff is read with its moves, copies, adds and deletes", () => {
  const none = "0".repeat(40);
  const raw = [
    `:100644 100644 ${A} ${B} M`,
    "changed.txt",
    `:000000 100755 ${none} ${B} A`,
    "added file.sh",
    `:100644 000000 ${A} ${none} D`,
    "deleted.txt",
    `:100644 100644 ${A} ${B} R087`,
    "old/name.txt",
    "new/name.txt",
    `:100644 100644 ${A} ${A} C100`,
    "source.txt",
    "copy.txt",
    "",
  ].join("\0");

  expect(parseChanges(raw)).toEqual([
    {
      path: "changed.txt",
      from: null,
      before: { mode: "100644", id: A },
      after: { mode: "100644", id: B },
    },
    { path: "added file.sh", from: null, before: null, after: { mode: "100755", id: B } },
    { path: "deleted.txt", from: null, before: { mode: "100644", id: A }, after: null },
    {
      path: "new/name.txt",
      from: "old/name.txt",
      before: { mode: "100644", id: A },
      after: { mode: "100644", id: B },
    },
    // A copy leaves its source in place: the copy is a new file.
    { path: "copy.txt", from: null, before: null, after: { mode: "100644", id: A } },
  ]);
});
