import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { ADB_TIMEOUT_MS, createAdbRunner, findOnPath } from "./adb.js";

let directory = "";
let fake = "";
let argvFile = "";

// A fake adb: records its argv, then does what the first argument asks.
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "android-adb-"));
  fake = join(directory, "adb");
  argvFile = join(directory, "argv.txt");
  await writeFile(
    fake,
    `#!/bin/sh
printf '%s\\n' "$@" > "${argvFile}"
case "$1" in
  out) printf 'hello'; exit 0 ;;
  bytes) printf '\\211PNG\\r\\n\\032\\n'; exit 0 ;;
  fail) echo 'error: device offline' >&2; exit 1 ;;
  failout) echo 'failed to connect' ; exit 1 ;;
  hang) exec sleep 30 ;;
  big) head -c 5000000 /dev/zero; exit 0 ;;
esac
exit 0
`,
  );
  await chmod(fake, 0o755);
});
afterAll(() => rm(directory, { recursive: true, force: true }));

test("stdout comes back as a Buffer and the arguments are passed as given", async () => {
  const adb = createAdbRunner({ adbPath: fake });
  const out = await adb.run(["out", "a b", "$(reboot)", ";x", ""]);
  expect(Buffer.isBuffer(out)).toBe(true);
  expect(out.toString()).toBe("hello");
  expect((await readFile(argvFile, "utf8")).split("\n").slice(0, -1)).toEqual([
    "out",
    "a b",
    "$(reboot)",
    ";x",
    "",
  ]);
});

test("binary output keeps its bytes", async () => {
  const out = await createAdbRunner({ adbPath: fake }).run(["bytes"], { binary: true });
  expect([...out.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
});

test("a non-zero exit rejects with the text adb printed", async () => {
  const adb = createAdbRunner({ adbPath: fake });
  await expect(adb.run(["fail"])).rejects.toThrow("error: device offline");
  await expect(adb.run(["failout"])).rejects.toThrow("failed to connect");
});

test("a hang is killed at the timeout and rejects", async () => {
  const adb = createAdbRunner({ adbPath: fake });
  const started = Date.now();
  await expect(adb.run(["hang"], { timeoutMs: 150 })).rejects.toThrow(/timed out after 150 ms/);
  expect(Date.now() - started).toBeLessThan(5000);
});

test("output past the cap kills the child and rejects", async () => {
  const adb = createAdbRunner({ adbPath: fake });
  await expect(adb.run(["big"])).rejects.toThrow(/more than/);
});

test("a missing binary rejects with adb is not installed", async () => {
  const adb = createAdbRunner({ adbPath: join(directory, "nope") });
  await expect(adb.run(["devices"])).rejects.toThrow("adb is not installed");
});

test("a spawn that throws rejects instead of throwing", async () => {
  const adb = createAdbRunner({
    adbPath: fake,
    spawn: () => {
      throw new Error("EMFILE");
    },
  });
  await expect(adb.run(["devices"])).rejects.toThrow("EMFILE");
});

test("the default timeout is 15 seconds", () => {
  expect(ADB_TIMEOUT_MS).toBe(15_000);
});

test("findOnPath finds an executable named adb on PATH, and nothing when there is none", () => {
  expect(findOnPath("adb", { PATH: `/nonexistent:${directory}` })).toBe(fake);
  expect(findOnPath("adb", { PATH: "/nonexistent" })).toBeNull();
  expect(findOnPath("adb", {})).toBeNull();
});
