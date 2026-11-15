import { randomUUID } from "node:crypto";
import { lstat, open, realpath, rm } from "node:fs/promises";
import { isAbsolute, join, normalize, sep } from "node:path";
import type { Author, FileLines, Mark, TrackedFile, Turn } from "../shared/contracts.js";
import { parseBlame } from "./blame.js";
import { git, gitText } from "./git.js";
import { AGENTS, authorsOf } from "./record.js";
import type { Shadow } from "./shadow.js";
import { FILE_MAX_BYTES, snapshotEnv } from "./snapshot.js";
import type { WorkTree } from "./work-tree.js";

/** The commits the file list reads: the latest changes are the ones a review is about. */
const LOG_MAX_COMMITS = 500;
/** The most files the list answers with. */
export const FILES_MAX = 200;
/** A file with a zero byte this early is not text. */
const SNIFF_BYTES = 8000;
const START = "\u0001";

async function headOf(shadow: Shadow): Promise<string> {
  return gitText(["--git-dir", shadow.gitDir, "rev-parse", "--verify", "--quiet", "HEAD"]).catch(
    () => "",
  );
}

/** The files agents changed that still exist, the latest change first. */
export async function listFiles(shadow: Shadow, workTree: WorkTree): Promise<TrackedFile[]> {
  if (!(await headOf(shadow))) return [];
  const log = await gitText([
    "--git-dir",
    shadow.gitDir,
    "log",
    "HEAD",
    `--author=^${AGENTS} <`,
    "--no-renames",
    `--max-count=${LOG_MAX_COMMITS}`,
    `--format=${START}%at%x09%s`,
    "--name-only",
    "-z",
  ]);
  const files = new Map<string, TrackedFile>();
  for (const chunk of log.split(START)) {
    // The header ends at the first zero byte; the paths follow, each ended by one.
    const [header = "", ...names] = chunk.split("\0");
    const tab = header.indexOf("\t");
    if (tab === -1) continue;
    const at = Number(header.slice(0, tab)) * 1000;
    const agents = authorsOf(header.slice(tab + 1));
    for (const name of names) {
      const path = name.replace(/^\n/, "");
      if (!path) continue;
      const known = files.get(path);
      if (!known) {
        files.set(path, { path, at, agents: [...agents] });
        continue;
      }
      for (const agent of agents) {
        if (!known.agents.some((each) => each.id === agent.id)) known.agents.push(agent);
      }
    }
  }
  const present: TrackedFile[] = [];
  for (const file of files.values()) {
    if (present.length >= FILES_MAX) break;
    const found = await lstat(join(workTree.top, file.path)).catch(() => null);
    if (found?.isFile()) present.push(file);
  }
  return present;
}

/** The file's real place when `path` names a file inside the checkout, else null. */
async function locate(workTree: WorkTree, path: string): Promise<string | null> {
  if (isAbsolute(path) || path.includes("\0")) return null;
  const clean = normalize(path);
  if (clean === ".." || clean.startsWith(`..${sep}`)) return null;
  // A link may point outside the checkout: the real path decides.
  const real = await realpath(join(workTree.top, clean)).catch(() => null);
  return real !== null && real.startsWith(workTree.top + sep) ? real : null;
}

async function isBinary(file: string): Promise<boolean> {
  const handle = await open(file, "r");
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(SNIFF_BYTES), 0, SNIFF_BYTES, 0);
    return buffer.subarray(0, bytesRead).includes(0);
  } finally {
    await handle.close();
  }
}

/**
 * The commit to blame: the history's last one when the file on disk is what it holds, else a
 * commit of the file as it is now, which no ref names. Lines it adds were written since the last
 * recorded turn.
 */
async function commitOfNow(
  shadow: Shadow,
  workTree: WorkTree,
  input: { head: string; path: string; mode: string; recorded: string },
): Promise<string> {
  const dir = ["--git-dir", shadow.gitDir];
  // Hashed in the checkout, so its line-ending and filter settings apply as they did at snapshot.
  const now = await gitText(["hash-object", "-w", "--", input.path], {
    cwd: workTree.top,
    env: snapshotEnv(workTree, shadow),
  });
  if (now === input.recorded) return input.head;
  const index = join(shadow.scratch, `read-${randomUUID()}.index`);
  const env = { GIT_INDEX_FILE: index };
  try {
    await git([...dir, "read-tree", input.head], { env });
    await git([...dir, "update-index", "-z", "--index-info"], {
      env,
      input: `${input.mode} ${now}\t${input.path}\0`,
    });
    const tree = await gitText([...dir, "write-tree"], { env });
    return await gitText([...dir, "commit-tree", tree, "-p", input.head], {
      env: {
        GIT_AUTHOR_NAME: "pending",
        GIT_AUTHOR_EMAIL: "pending@paseo.invalid",
        GIT_COMMITTER_NAME: "paseo",
        GIT_COMMITTER_EMAIL: "paseo@paseo.invalid",
      },
      input: "pending\n",
    });
  } finally {
    await rm(index, { force: true });
  }
}

/** One file's lines, with the turn that wrote each line an agent wrote. */
export async function readFile(
  shadow: Shadow,
  workTree: WorkTree,
  requested: string,
): Promise<FileLines> {
  const file = await locate(workTree, requested);
  if (file === null) return { status: "missing" };
  const found = await lstat(file);
  if (!found.isFile()) return { status: "missing" };
  if (found.size > FILE_MAX_BYTES) return { status: "too_large" };
  // Git names paths from the top folder, with forward slashes.
  const path = file
    .slice(workTree.top.length + 1)
    .split(sep)
    .join("/");
  const head = await headOf(shadow);
  if (!head) return { status: "untracked" };
  const dir = ["--git-dir", shadow.gitDir];
  const entry = await gitText([...dir, "ls-tree", head, "--", path]);
  const match = /^(\d+) blob ([0-9a-f]+)\t/.exec(entry);
  if (!match) return { status: "untracked" };
  if (await isBinary(file)) return { status: "binary" };

  const commit = await commitOfNow(shadow, workTree, {
    head,
    path,
    mode: match[1] ?? "100644",
    recorded: match[2] ?? "",
  });
  // -M and -C: a line an agent moved, in the file or from another, stays with who wrote it.
  const output = await git([...dir, "blame", "--porcelain", "-M", "-C", commit, "--", path]);
  const blame = parseBlame(output.toString("utf8"));

  const turns: Turn[] = [];
  const turnOf = new Map<string, number | null>();
  const indexOf = (id: string): number | null => {
    const known = turnOf.get(id);
    if (known !== undefined) return known;
    const info = blame.commits.get(id);
    const agents: Author[] = info?.author === AGENTS ? authorsOf(info.summary) : [];
    const made =
      agents.length === 0 ? null : turns.push({ at: (info?.time ?? 0) * 1000, agents }) - 1;
    turnOf.set(id, made);
    return made;
  };
  const marks: Mark[] = [];
  blame.lines.forEach((line, at) => {
    const turn = indexOf(line.commit);
    if (turn === null) return;
    const last = marks.at(-1);
    if (last && last.turn === turn && last.start + last.count === at + 1) last.count += 1;
    else marks.push({ start: at + 1, count: 1, turn });
  });
  return { status: "ready", lines: blame.lines.map((line) => line.text), marks, turns };
}
