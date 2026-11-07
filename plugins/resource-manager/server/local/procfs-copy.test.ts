import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// server/local/procfs.ts is a verbatim copy of shared-mcp's reader: a built-in may import only
// from its own directory. This test reads both files (it imports neither) and fails on any
// difference, so a change to one has to be copied to the other.
const COPY = fileURLToPath(new URL("./procfs.ts", import.meta.url));
const ORIGINAL = fileURLToPath(new URL("../../../shared-mcp/server/procfs.ts", import.meta.url));

describe("procfs copy", () => {
  it("matches plugins/shared-mcp/server/procfs.ts byte for byte", () => {
    expect(readFileSync(COPY, "utf8")).toBe(readFileSync(ORIGINAL, "utf8"));
  });
});
