import { spawn } from "node:child_process";
import { AuthorSchema, type Author } from "../shared/contracts.js";
import { GIT_TIMEOUT_MS, GitError, git, gitEnv, gitText } from "./git.js";
import type { Shadow } from "./shadow.js";
import type { WorkTree } from "./work-tree.js";

/** A turn that changes more files than this is not recorded: a checkout of another branch. */
export const RECORD_MAX_FILES = 300;
/** The author name of a commit that holds agents' lines. */
export const AGENTS = "agents";
/** The author name of every other commit: lines no agent wrote. */
export const OUTSIDE = "outside";
const TITLE_MAX = 120;

/** A change that was not recorded, for a reason that is no fault. */
export class RecordSkipped extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "RecordSkipped";
  }
}

export interface RecordInput {
  shadow: Shadow;
  workTree: WorkTree;
  /** The snapshot before the change and the one after it. */
  before: string;
  after: string;
  /** The agents that ran in between. */
  authors: readonly Author[];
  /** When the change was seen, in milliseconds. */
  at: number;
}

interface Side {
  mode: string;
  id: string;
}

interface Change {
  /** The file's path after the change, or its last path when it was deleted. */
  path: string;
  /** Where the file was before, when the change moved it. */
  from: string | null;
  before: Side | null;
  after: Side | null;
}

const isNone = (id: string) => /^0+$/.test(id);
const isFile = (side: Side | null) =>
  side === null || side.mode === "100644" || side.mode === "100755";

/** Reads `git diff-tree --raw -z`: a header, then one path, or two for a move. */
export function parseChanges(raw: string): Change[] {
  const parts = raw.split("\0");
  const changes: Change[] = [];
  for (let at = 0; at < parts.length; ) {
    const header = /^:(\d+) (\d+) ([0-9a-f]+) ([0-9a-f]+) ([A-Z])\d*$/.exec(parts[at] ?? "");
    if (!header) {
      at += 1;
      continue;
    }
    const [, oldMode = "", newMode = "", oldId = "", newId = "", status] = header;
    const moved = status === "R" || status === "C";
    const first = parts[at + 1] ?? "";
    const path = moved ? (parts[at + 2] ?? "") : first;
    at += moved ? 3 : 2;
    changes.push({
      path,
      // A copy leaves its source where it was: only a rename is a move.
      from: status === "R" ? first : null,
      before: isNone(oldId) || status === "C" ? null : { mode: oldMode, id: oldId },
      after: isNone(newId) ? null : { mode: newMode, id: newId },
    });
  }
  return changes;
}

type Entry = [path: string, side: Side | null];

/** `git update-index --index-info` input: a mode of 0 takes the path out. */
function indexInfo(entries: readonly Entry[]): string {
  return entries
    .map(([path, side]) => `${side?.mode ?? "0"} ${side?.id ?? "0".repeat(40)}\t${path}\0`)
    .join("");
}

/** Runs `git <from>` into `git <to>` without holding the bytes. */
function pipe(
  from: { args: string[]; cwd?: string },
  to: { args: string[] },
  input: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const env = gitEnv(process.env);
    const source = spawn("git", from.args, { cwd: from.cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    const sink = spawn("git", to.args, { env, stdio: ["pipe", "ignore", "pipe"] });
    const errors: Buffer[] = [];
    const codes: Array<number | null> = [];
    let failed: Error | null = null;
    const stop = (error: Error) => {
      failed ??= error;
      source.kill("SIGKILL");
      sink.kill("SIGKILL");
    };
    const timer = setTimeout(
      () => stop(new GitError(from.args[0] ?? "", null, "timed out")),
      GIT_TIMEOUT_MS,
    );
    const closed = (code: number | null) => {
      codes.push(code);
      if (codes.length < 2) return;
      clearTimeout(timer);
      if (failed) reject(failed);
      else if (codes.every((each) => each === 0)) resolve();
      else reject(new GitError(from.args[0] ?? "", null, Buffer.concat(errors).toString("utf8")));
    };
    for (const child of [source, sink]) {
      child.stderr.on("data", (chunk: Buffer) => void errors.push(chunk));
      child.on("error", stop);
      child.on("close", closed);
      child.stdin.on("error", () => undefined);
    }
    source.stdout.pipe(sink.stdin);
    source.stdin.end(input);
  });
}

/** Copies into the shadow store the blobs it does not hold itself. */
async function copyBlobs(input: RecordInput, ids: readonly string[]): Promise<void> {
  const { shadow, workTree } = input;
  // Asked without the alternate: a blob the repository holds may be pruned there one day.
  const checked = await gitText(["--git-dir", shadow.gitDir, "cat-file", "--batch-check"], {
    input: `${ids.join("\n")}\n`,
  });
  const missing = checked
    .split("\n")
    .filter((line) => line.endsWith(" missing"))
    .map((line) => line.split(" ")[0] ?? "");
  if (missing.length === 0) return;
  await pipe(
    { args: ["pack-objects", "--stdout", "-q"], cwd: workTree.top },
    { args: ["--git-dir", shadow.gitDir, "unpack-objects", "-q"] },
    `${missing.join("\n")}\n`,
  );
}

function subjectOf(authors: readonly Author[]): string {
  // One line: JSON escapes a line break in a title.
  return JSON.stringify({
    v: 1,
    agents: authors.map((author) => ({
      id: author.id,
      title: author.title === null ? null : author.title.slice(0, TITLE_MAX),
      provider: author.provider,
    })),
  });
}

/** The agents a commit's subject names; none for a subject that is not ours. */
export function authorsOf(subject: string): Author[] {
  try {
    const parsed = JSON.parse(subject) as { agents?: unknown };
    const agents = AuthorSchema.array().safeParse(parsed.agents);
    return agents.success ? agents.data : [];
  } catch {
    return [];
  }
}

/**
 * Records what changed between two snapshots as the work of `authors`. Answers how many files
 * the agents' commit holds; 0 when nothing a file panel could show changed.
 */
export async function record(input: RecordInput): Promise<number> {
  const { shadow, workTree, before, after, authors, at } = input;
  const dir = ["--git-dir", shadow.gitDir];
  // The trees' blobs are in the shadow store or in the repository's.
  const reads = { env: { GIT_ALTERNATE_OBJECT_DIRECTORIES: workTree.objects } };
  const raw = await git([...dir, "diff-tree", "-r", "-M", "--raw", "-z", before, after], reads);
  // A link, a submodule or a file that became one has no lines to show.
  const changes = parseChanges(raw.toString("utf8")).filter(
    (change) => isFile(change.before) && isFile(change.after),
  );
  if (changes.length === 0) return 0;
  if (changes.length > RECORD_MAX_FILES) {
    throw new RecordSkipped(`${changes.length} changed files, more than ${RECORD_MAX_FILES}`);
  }
  const ids = new Set<string>();
  for (const change of changes) {
    if (change.before) ids.add(change.before.id);
    if (change.after) ids.add(change.after.id);
  }
  await copyBlobs(input, Array.from(ids));

  const head = await gitText([...dir, "rev-parse", "--verify", "--quiet", "HEAD"]).catch(() => "");
  // The index follows the history, whatever an earlier failure left in it.
  await git([...dir, "read-tree", ...(head ? [head] : ["--empty"])]);
  const seconds = Math.floor(at / 1000);
  let parent = head;
  let tree = head ? await gitText([...dir, "rev-parse", `${head}^{tree}`]) : "";
  const commit = async (entries: readonly Entry[], name: string, subject: string) => {
    await git([...dir, "update-index", "-z", "--index-info"], { input: indexInfo(entries) });
    const next = await gitText([...dir, "write-tree"]);
    if (next === tree) return false;
    const identity = {
      GIT_AUTHOR_NAME: name,
      GIT_AUTHOR_EMAIL: `${name}@paseo.invalid`,
      GIT_AUTHOR_DATE: `@${seconds} +0000`,
      GIT_COMMITTER_NAME: "paseo",
      GIT_COMMITTER_EMAIL: "paseo@paseo.invalid",
      GIT_COMMITTER_DATE: `@${seconds} +0000`,
    };
    parent = await gitText([...dir, "commit-tree", next, ...(parent ? ["-p", parent] : [])], {
      env: identity,
      input: `${subject}\n`,
    });
    tree = next;
    return true;
  };

  // 1. The files as they were when the turn began, where they were: what changed since the
  //    shadow last saw them was not this turn's.
  await commit(
    changes.map((change): Entry => [change.from ?? change.path, change.before]),
    OUTSIDE,
    "outside",
  );
  // 2. The moves, with the old content: an exact rename, which blame follows.
  const moves = changes.filter((change) => change.from !== null);
  if (moves.length > 0) {
    await commit(
      moves.flatMap((change): Entry[] => [
        [change.from ?? "", null],
        [change.path, change.before],
      ]),
      OUTSIDE,
      "moved",
    );
  }
  // 3. The turn's own change.
  const recorded = await commit(
    changes.map((change): Entry => [change.path, change.after]),
    AGENTS,
    subjectOf(authors),
  );
  if (parent !== head) await git([...dir, "update-ref", "HEAD", parent]);
  // Snapshots leave trees and blobs no commit names; Git clears them once they are old.
  await git([...dir, "gc", "--auto", "--quiet"]).catch(() => undefined);
  return recorded ? changes.length : 0;
}
