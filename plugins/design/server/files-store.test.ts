import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFilesStore, publicFile, type DesignFile } from "./files-store.js";

function file(id: string, projectKey = "p1"): DesignFile {
  return {
    id,
    projectKey,
    name: `Design ${id}`,
    createdAt: 1,
    lastAgentId: null,
    secrets: {
      editLink: `figcraft://join?host=x&file=${id}&token=e`,
      viewLink: `figcraft://join?host=x&file=${id}&token=v`,
      ownerToken: "o",
    },
  };
}

function store() {
  const path = join(mkdtempSync(join(tmpdir(), "design-files-")), "design", "files.json");
  return { path, store: createFilesStore({ file: path, log: () => {} }) };
}

describe("files store", () => {
  it("adds, lists by project, renames, records the agent and removes", async () => {
    const { store: s } = store();
    await s.add(file("a"));
    await s.add(file("b", "p2"));
    expect((await s.list("p1")).map((f) => f.id)).toEqual(["a"]);
    await s.update("a", { name: "Login", lastAgentId: "agent-1" });
    expect(await s.get("a")).toMatchObject({ name: "Login", lastAgentId: "agent-1" });
    await s.remove("a");
    expect(await s.list("p1")).toEqual([]);
  });
  it("survives a restart and keeps the file private to the user", async () => {
    const { path, store: s } = store();
    await s.add(file("a"));
    const again = createFilesStore({ file: path, log: () => {} });
    expect(await again.get("a")).toEqual(file("a"));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(path, "utf8")).version).toBe(1);
  });
  it("rejects an update to a file it does not have", async () => {
    const { store: s } = store();
    await expect(s.update("nope", { name: "x" })).rejects.toThrow("No design file nope");
  });
  it("starts empty from a corrupt file and logs it, without the contents", async () => {
    const dir = mkdtempSync(join(tmpdir(), "design-files-"));
    const path = join(dir, "files.json");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(path, "{not json token=secret");
    const lines: string[] = [];
    const s = createFilesStore({ file: path, log: (line) => lines.push(line) });
    expect(await s.list("p1")).toEqual([]);
    expect(lines.join("\n")).toContain("files.json could not be read");
    expect(lines.join("\n")).not.toContain("secret");
  });
  it("publicFile drops the links and the owner token", () => {
    expect(publicFile(file("a"))).not.toHaveProperty("secrets");
  });
});
