import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const THREE_FILE = "three.module.min.js";
/** Pinned in vendor/SOURCES.md; a different file is never served. */
export const THREE_SHA256 = "08fd7545d13d2c7fb65ab691530a802dafefd638596501854f267d0fb13c39e7";
export const THREE_BYTES = 691648;

/** Reads the vendored three.js on each call; the daemon keeps no copy in memory. */
export async function readThreeAsset(vendorDirectory: string | null): Promise<Uint8Array> {
  if (vendorDirectory === null) {
    throw new Error("The office was started without its plugin directory");
  }
  const bytes = await readFile(join(vendorDirectory, THREE_FILE));
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== THREE_SHA256) {
    throw new Error(`Unexpected ${THREE_FILE} (sha256 ${digest})`);
  }
  return bytes;
}
