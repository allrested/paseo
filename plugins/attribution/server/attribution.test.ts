// The snapshot, the record and the reader against real Git.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import type { Author, FileLines } from "../shared/contracts.js";
import { listFiles, readFile } from "./reader.js";
import { record } from "./record.js";
import { findShadow, openShadow, removeOrphans, type Shadow } from "./shadow.js";
import { FILE_MAX_BYTES, snapshot } from "./snapshot.js";
import { lines, makeRepo, type TestRepo } from "./testing.js";
import { findWorkTree, type WorkTree } from "./work-tree.js";

const ONE: Author = { id: "a1", title: "Checkout total", provider: "claude" };
const TWO: Author = { id: "a2", title: "Tax rules", provider: "codex" };
const T1 = Date.parse("2026-11-15T10:00:00Z");
const T2 = Date.parse("2026-11-15T11:00:00Z");

let repos: TestRepo[] = [];
afterEach(() => {
  for (const repo of repos) repo.remove();
  repos = [];
});

async function setup(files: Record<string, string>, folder = "") {
  const repo = makeRepo(files);
  repos.push(repo);
  const workTree = (await findWorkTree(join(repo.top, folder))) as WorkTree;
  const shadow = await openShadow(repo.root, workTree.top);
  /** What an agent turn does: a snapshot, the edit, a snapshot, the record. */
  const turn = async (authors: Author[], at: number, edit: () => void) => {
    const before = await snapshot(workTree, shadow);
    edit();
    const after = await snapshot(workTree, shadow);
    return record({ shadow, workTree, before, after, authors, at });
  };
  return { repo, workTree, shadow, turn };
}

/** Every file under a folder, with its bytes, to tell whether anything changed. */
function contents(folder: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const entry of readdirSync(folder, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    found[path] = readFileSync(path).toString("base64");
  }
  return found;
}

/** The lines of a ready answer with the agents of each, "-" for nobody. */
function owners(answer: FileLines): string[] {
  if (answer.status !== "ready") throw new Error(`The answer is ${answer.status}`);
  const who = answer.lines.map(() => "-");
  for (const mark of answer.marks) {
    const names = answer.turns[mark.turn]?.agents.map((agent) => agent.id).join("+") ?? "?";
    for (let line = mark.start; line < mark.start + mark.count; line += 1) who[line - 1] = names;
  }
  return answer.lines.map((text, at) => `${who[at]} ${text}`);
}

test("a folder outside a checkout has no work tree, and one inside finds the top", async () => {
  const { repo, workTree } = await setup({ "src/a.txt": "one\n" }, "src");

  expect(workTree.top).toBe(repo.top);
  expect(workTree.objects).toBe(join(repo.top, ".git", "objects"));
  expect(await findWorkTree(repo.root.replace(/stores$/, ""))).toBeNull();
  expect(await findWorkTree(join(repo.top, "no-such-folder"))).toBeNull();
});

test("a snapshot and a record leave the repository as it was", async () => {
  const { repo, turn } = await setup({ "a.txt": "one\ntwo\n", ".gitignore": "ignored/\n" });
  repo.write("staged.txt", "staged\n");
  repo.git("add", "staged.txt");
  repo.write("a.txt", "one\ntwo\nthe person's edit\n");
  const before = contents(join(repo.top, ".git"));

  await turn([ONE], T1, () => {
    repo.write("a.txt", "one\nTWO\nthe person's edit\n");
    repo.write("new.txt", "made by the agent\n");
  });

  expect(contents(join(repo.top, ".git"))).toEqual(before);
});

test("the lines of a turn read as its agent's, and the rest as nobody's", async () => {
  const { repo, workTree, shadow, turn } = await setup({ "a.txt": "one\ntwo\nthree\n" });
  repo.write("a.txt", "one\ntwo\nthree\nthe person's edit\n");

  const files = await turn([ONE], T1, () => {
    repo.write("a.txt", "one\nTWO by the agent\nthree\nthe person's edit\n");
    repo.write("b.txt", "new\nfile\n");
  });

  expect(files).toBe(2);
  const a = await readFile(shadow, workTree, "a.txt");
  expect(owners(a)).toEqual(["- one", "a1 TWO by the agent", "- three", "- the person's edit"]);
  expect(a).toMatchObject({ turns: [{ at: T1, agents: [ONE] }] });
  expect(owners(await readFile(shadow, workTree, "b.txt"))).toEqual(["a1 new", "a1 file"]);
});

test("an edit between two turns, and one after the last, is nobody's", async () => {
  const { repo, workTree, shadow, turn } = await setup({ "a.txt": "one\ntwo\nthree\n" });
  await turn([ONE], T1, () => repo.write("a.txt", "one\nagent one\ntwo\nthree\n"));
  // Between the turns the person edits; no snapshot sees it happen.
  repo.write("a.txt", "one\nagent one\ntwo\nby hand\nthree\n");
  await turn([TWO], T2, () =>
    repo.write("a.txt", "one\nagent one\ntwo\nby hand\nthree\nagent two\n"),
  );
  repo.write(
    "a.txt",
    "zero, since the last turn\none\nagent one\ntwo\nby hand\nthree\nagent two\n",
  );

  const answer = await readFile(shadow, workTree, "a.txt");

  expect(owners(answer)).toEqual([
    "- zero, since the last turn",
    "- one",
    "a1 agent one",
    "- two",
    "- by hand",
    "- three",
    "a2 agent two",
  ]);
  expect(answer).toMatchObject({
    turns: [
      { at: T1, agents: [ONE] },
      { at: T2, agents: [TWO] },
    ],
  });
});

test("a change made while two agents ran is credited to both", async () => {
  const { repo, workTree, shadow, turn } = await setup({ "a.txt": "one\n" });

  await turn([ONE, TWO], T1, () => repo.write("a.txt", "one\nshared\n"));

  expect(owners(await readFile(shadow, workTree, "a.txt"))).toEqual(["- one", "a1+a2 shared"]);
});

test("a file an agent moves keeps who wrote its lines", async () => {
  const { repo, workTree, shadow, turn } = await setup({ "old/name.txt": lines("kept", 12) });
  await turn([ONE], T1, () => repo.write("old/name.txt", `${lines("kept", 12)}by agent one\n`));

  await turn([TWO], T2, () => {
    rmSync(join(repo.top, "old/name.txt"));
    repo.write("new/name.txt", `${lines("kept", 12)}by agent one\nby agent two\n`);
  });

  const who = owners(await readFile(shadow, workTree, "new/name.txt"));
  expect(who.slice(0, 12).every((line) => line.startsWith("- kept"))).toBe(true);
  expect(who.slice(12)).toEqual(["a1 by agent one", "a2 by agent two"]);
});

test("ignored files, files over the limit and links stay out", async () => {
  const { repo, workTree, shadow, turn } = await setup({
    "a.txt": "one\n",
    ".gitignore": "ignored/\n",
  });

  const files = await turn([ONE], T1, () => {
    repo.write("ignored/build.txt", "built\n");
    repo.write("big.txt", "x".repeat(FILE_MAX_BYTES + 1));
    symlinkSync("a.txt", join(repo.top, "link.txt"));
    repo.write("a.txt", "one\ntwo\n");
  });

  expect(files).toBe(1);
  expect(await readFile(shadow, workTree, "ignored/build.txt")).toEqual({ status: "untracked" });
  expect(await readFile(shadow, workTree, "big.txt")).toEqual({ status: "too_large" });
  expect((await listFiles(shadow, workTree)).map((file) => file.path)).toEqual(["a.txt"]);
});

test("a turn that changes nothing records nothing", async () => {
  const { shadow, workTree, turn } = await setup({ "a.txt": "one\n" });

  expect(await turn([ONE], T1, () => undefined)).toBe(0);
  expect(await listFiles(shadow, workTree)).toEqual([]);
  expect(await readFile(shadow, workTree, "a.txt")).toEqual({ status: "untracked" });
});

test("the list has the files agents changed that still exist, the latest first", async () => {
  const { repo, workTree, shadow, turn } = await setup({ "a.txt": "one\n", "b.txt": "one\n" });
  await turn([ONE], T1, () => {
    repo.write("a.txt", "one\ntwo\n");
    repo.write("gone.txt", "soon deleted\n");
  });
  await turn([TWO], T2, () => {
    repo.write("b.txt", "one\ntwo\n");
    repo.write("a.txt", "one\ntwo\nthree\n");
    rmSync(join(repo.top, "gone.txt"));
  });

  expect(await listFiles(shadow, workTree)).toEqual([
    { path: "a.txt", at: T2, agents: [TWO, ONE] },
    { path: "b.txt", at: T2, agents: [TWO] },
  ]);
});

test("a file that is not text, is gone or lies outside the checkout has no lines", async () => {
  const { repo, workTree, shadow, turn } = await setup({ "a.txt": "one\n" });
  await turn([ONE], T1, () => {
    repo.write("data.bin", Buffer.from([1, 0, 2, 0]));
    repo.write("a.txt", "one\ntwo\n");
  });
  symlinkSync("/etc/hostname", join(repo.top, "outside.txt"));

  expect(await readFile(shadow, workTree, "data.bin")).toEqual({ status: "binary" });
  expect(await readFile(shadow, workTree, "no-such.txt")).toEqual({ status: "missing" });
  expect(await readFile(shadow, workTree, "../stores")).toEqual({ status: "missing" });
  expect(await readFile(shadow, workTree, "/etc/hostname")).toEqual({ status: "missing" });
  expect(await readFile(shadow, workTree, "outside.txt")).toEqual({ status: "missing" });
});

test("a linked work tree has its own store and reads the shared objects", async () => {
  const { repo } = await setup({ "a.txt": "one\ntwo\n" });
  const linked = join(repo.top, "..", "linked");
  repo.git("worktree", "add", "--quiet", linked, "-b", "feature");
  const workTree = (await findWorkTree(linked)) as WorkTree;
  const shadow = await openShadow(repo.root, workTree.top);

  const before = await snapshot(workTree, shadow);
  execFileSync("sh", ["-c", "printf 'one\\ntwo\\nthree\\n' > a.txt"], { cwd: linked });
  const after = await snapshot(workTree, shadow);
  await record({ shadow, workTree, before, after, authors: [ONE], at: T1 });

  expect(owners(await readFile(shadow, workTree, "a.txt"))).toEqual(["- one", "- two", "a1 three"]);
  // The first checkout's store is another one, and nothing was recorded there.
  expect(await findShadow(repo.root, repo.top)).not.toEqual(shadow);
});

test("a store whose folder is gone is removed, and the others stay", async () => {
  const kept = await setup({ "a.txt": "one\n" });
  const gone = makeRepo({ "a.txt": "one\n" });
  const lost: Shadow = await openShadow(kept.repo.root, gone.top);
  gone.remove();

  expect(await removeOrphans(kept.repo.root)).toBe(1);

  expect(await findShadow(kept.repo.root, kept.repo.top)).toEqual(kept.shadow);
  expect(readdirSync(kept.repo.root)).toHaveLength(1);
  expect(lost.gitDir.startsWith(kept.repo.root)).toBe(true);
});
