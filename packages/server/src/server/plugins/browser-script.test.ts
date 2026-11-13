import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { bundleBrowserScript } from "./browser-script.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "browser-script-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("bundles an entry and its imports into one script that runs without a module loader", async () => {
  const entry = path.join(dir, "entry.ts");
  await writeFile(path.join(dir, "dep.ts"), "export const n: number = 41;\n");
  await writeFile(
    entry,
    'import { n } from "./dep.js";\n(globalThis as { __probe?: number }).__probe = n + 1;\n',
  );

  const script = await bundleBrowserScript(entry);

  expect(script).not.toMatch(/\bimport\b|\brequire\(/);
  const sandbox: { __probe?: number } = {};
  new Function("globalThis", script)(sandbox);
  expect(sandbox.__probe).toBe(42);
});

test("rejects with the build error for an entry that does not compile", async () => {
  const entry = path.join(dir, "entry.ts");
  await writeFile(entry, 'import { missing } from "./nowhere.js";\nconsole.log(missing);\n');

  await expect(bundleBrowserScript(entry)).rejects.toThrow(/nowhere/);
});
