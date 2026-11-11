import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { THREE_BYTES, THREE_FILE, readThreeAsset } from "./asset.js";

const VENDOR = fileURLToPath(new URL("../vendor/", import.meta.url));

test("serves the vendored three.js build when its checksum matches", async () => {
  const bytes = await readThreeAsset(VENDOR);
  expect(bytes.byteLength).toBe(THREE_BYTES);
  expect(bytes).toBeInstanceOf(Uint8Array);
});

test("refuses a file whose checksum differs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "office-asset-"));
  try {
    await writeFile(join(directory, THREE_FILE), "export const REVISION = '170';");
    await expect(readThreeAsset(directory)).rejects.toThrow(/^Unexpected three\.module\.min\.js/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("refuses when the daemon did not pass the plugin directory", async () => {
  await expect(readThreeAsset(null)).rejects.toThrow(
    "The office was started without its plugin directory",
  );
});
