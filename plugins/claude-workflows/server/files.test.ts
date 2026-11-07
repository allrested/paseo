import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isFileError, isInside, isMissing, listNames, parseJson } from "./files.js";

let root = "";

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "claude-workflows-files-")));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** The error a real operation rejects with. */
async function failure(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (error) {
    return error;
  }
  throw new Error("expected the operation to fail");
}

function errnoError(code: string): Error {
  return Object.assign(new Error(`${code}: fixture`), { code });
}

describe("file helpers", () => {
  it("treats a missing path, a missing parent dir and a gone process as missing", async () => {
    await writeFile(join(root, "file"), "x");
    const missing = await failure(readFile(join(root, "absent")));
    const notDir = await failure(readFile(join(root, "file", "child")));
    const isDir = await failure(readFile(root));

    expect([missing, notDir, errnoError("ESRCH")].map(isMissing)).toEqual([true, true, true]);
    expect([isDir, new Error("plain")].map(isMissing)).toEqual([false, false]);
  });

  it("counts errno failures as file errors, and nothing else", async () => {
    const isDir = await failure(readFile(root));
    const missing = await failure(readFile(join(root, "absent")));
    const invalidArgument = Object.assign(new Error("bad argument"), {
      code: "ERR_INVALID_ARG_TYPE",
    });

    expect([isDir, missing].map(isFileError)).toEqual([true, true]);
    expect([invalidArgument, new TypeError("bug"), "ENOENT"].map(isFileError)).toEqual([
      false,
      false,
      false,
    ]);
  });

  it("lists a directory's names, and none for a missing one", async () => {
    await mkdir(join(root, "dir"));
    await writeFile(join(root, "dir", "b"), "");
    await writeFile(join(root, "dir", "a"), "");

    expect((await listNames(join(root, "dir"))).sort()).toEqual(["a", "b"]);
    await expect(listNames(join(root, "absent"))).resolves.toEqual([]);
  });

  it("parses complete JSON only", () => {
    expect(parseJson('{"status":"completed"}')).toEqual({ status: "completed" });
    expect(parseJson("null")).toBeNull();
    expect(parseJson('{"status":"comp')).toBeUndefined();
    expect(parseJson("")).toBeUndefined();
  });

  it("tells whether a path lies inside a directory", () => {
    expect(isInside("/work/project", "/work/project/src/a.ts")).toBe(true);
    expect(isInside("/work/project", "/work/project/..a/b.ts")).toBe(true);
    expect(isInside("/work/project", "/work/project")).toBe(false);
    expect(isInside("/work/project", "/work/project-other/a.ts")).toBe(false);
    expect(isInside("/work/project", "/work/..project/a.ts")).toBe(false);
    expect(isInside("/work/project", "/etc/hosts")).toBe(false);
  });
});
