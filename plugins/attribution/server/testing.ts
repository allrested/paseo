// Real repositories in temporary folders, for the tests.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gitEnv } from "./git.js";

const IDENTITY = {
  GIT_AUTHOR_NAME: "Person",
  GIT_AUTHOR_EMAIL: "person@example.test",
  GIT_COMMITTER_NAME: "Person",
  GIT_COMMITTER_EMAIL: "person@example.test",
};

export interface TestRepo {
  /** The checkout's top folder. */
  top: string;
  /** A folder for the shadow stores. */
  root: string;
  /** Runs Git in the checkout as the person would. */
  git(...args: string[]): string;
  /** Writes a file under the checkout, with the folders above it. */
  write(path: string, text: string | Buffer): void;
  remove(): void;
}

/** A repository with one commit holding `files`. */
export function makeRepo(files: Record<string, string>): TestRepo {
  // macOS keeps its temporary folder behind a link; the plugin resolves links.
  const base = realpathSync(mkdtempSync(join(tmpdir(), "attribution-")));
  const top = join(base, "repo");
  const root = join(base, "stores");
  mkdirSync(top);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: top, env: gitEnv(process.env, IDENTITY), encoding: "utf8" });
  const write = (path: string, text: string | Buffer) => {
    mkdirSync(dirname(join(top, path)), { recursive: true });
    writeFileSync(join(top, path), text);
  };
  git("init", "--quiet", "--initial-branch=main");
  for (const [path, text] of Object.entries(files)) write(path, text);
  git("add", "--all");
  git("commit", "--quiet", "--message", "base");
  return { top, root, git, write, remove: () => rmSync(base, { recursive: true, force: true }) };
}

/** Lines "<prefix> 1" to "<prefix> <count>", each long enough for Git to follow when moved. */
export function lines(prefix: string, count: number): string {
  return Array.from(
    { length: count },
    (_, at) => `${prefix} line number ${at + 1} of the file\n`,
  ).join("");
}
