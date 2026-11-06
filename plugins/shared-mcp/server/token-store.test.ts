import { mkdtempSync, rmSync } from "node:fs";
import { chmod, link, lstat, readdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InvalidTokenFileError, loadOrCreateToken } from "./token-store.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, link: vi.fn(actual.link) };
});

describe("loadOrCreateToken", () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "shared-mcp-token-"));
    file = join(dir, "token");
    vi.mocked(link).mockClear();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates a 64-character hex token and stores it in the file", async () => {
    const token = await loadOrCreateToken(file);

    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(await readFile(file, "utf8")).toBe(`${token}\n`);
    expect(link).toHaveBeenCalledOnce();
    expect(link).toHaveBeenCalledWith(expect.stringMatching(/\.tmp$/), file);
  });

  it.runIf(process.platform !== "win32")("creates the token file with mode 0600", async () => {
    await loadOrCreateToken(file);

    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it("returns the stored token on the next call", async () => {
    const first = await loadOrCreateToken(file);

    expect(await loadOrCreateToken(file)).toBe(first);
    expect(link).toHaveBeenCalledOnce();
  });

  it("creates missing parent directories", async () => {
    const nested = join(dir, "paseo-home", "shared-mcp", "token");

    const token = await loadOrCreateToken(nested);

    expect((await stat(join(dir, "paseo-home", "shared-mcp"))).isDirectory()).toBe(true);
    expect(await readFile(nested, "utf8")).toBe(`${token}\n`);
  });

  it("gives concurrent callers one token and leaves no temp files behind", async () => {
    const [first, second, third] = await Promise.all([
      loadOrCreateToken(file),
      loadOrCreateToken(file),
      loadOrCreateToken(file),
    ]);

    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(await readdir(dir)).toEqual(["token"]);
  });

  it.each(["EPERM", "ENOTSUP", "ENOSYS"])(
    "creates the token without a hard link when link() fails with %s",
    async (code) => {
      vi.mocked(link).mockRejectedValueOnce(Object.assign(new Error("no hard links"), { code }));

      const token = await loadOrCreateToken(file);

      expect(link).toHaveBeenCalledOnce();
      expect(token).toMatch(/^[0-9a-f]{64}$/);
      expect(await readFile(file, "utf8")).toBe(`${token}\n`);
      expect(await readdir(dir)).toEqual(["token"]);
    },
  );

  it.runIf(process.platform !== "win32")("tightens a readable token file to 0600", async () => {
    const stored = "ab".repeat(32);
    await writeFile(file, `${stored}\n`);
    await chmod(file, 0o644);

    expect(await loadOrCreateToken(file)).toBe(stored);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(link).not.toHaveBeenCalled();
  });

  it("rejects a token file that does not hold a hex token and leaves it alone", async () => {
    await writeFile(file, "not-a-token\n");

    await expect(loadOrCreateToken(file)).rejects.toBeInstanceOf(InvalidTokenFileError);
    expect(await readFile(file, "utf8")).toBe("not-a-token\n");
    expect(link).not.toHaveBeenCalled();
  });

  it("names the file but never echoes its content when the token is truncated", async () => {
    const truncated = "cd".repeat(31) + "c";
    await writeFile(file, `${truncated}\n`);

    const error = await loadOrCreateToken(file).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(InvalidTokenFileError);
    expect((error as InvalidTokenFileError).file).toBe(file);
    expect((error as InvalidTokenFileError).message).toContain(file);
    expect((error as InvalidTokenFileError).message).not.toContain(truncated);
  });

  it.runIf(process.platform !== "win32")("rejects a dangling token symlink", async () => {
    await symlink(join(dir, "missing-target"), file);

    await expect(loadOrCreateToken(file)).rejects.toBeInstanceOf(InvalidTokenFileError);
    expect(link).toHaveBeenCalledOnce();
    expect((await lstat(file)).isSymbolicLink()).toBe(true);
    expect(await readdir(dir)).toEqual(["token"]);
  });

  it("rejects, never throws synchronously, when a parent of the token path is a file", async () => {
    await writeFile(join(dir, "blocker"), "x");
    const blocked = join(dir, "blocker", "shared-mcp", "token");

    const pending = loadOrCreateToken(blocked);

    await expect(pending).rejects.toThrow(blocked);
    expect(link).not.toHaveBeenCalled();
    expect(await readdir(dir)).toEqual(["blocker"]);
  });
});
