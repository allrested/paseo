import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SkillEntry } from "../shared/catalog.js";
import type { SyncStatus } from "../shared/rpc.js";
import { syncSkills, type SyncInput } from "./sync.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const ALPHA: SkillEntry = {
  id: "alpha",
  label: "Alpha",
  summary: "",
  folders: ["alpha-one", "alpha-two"],
  defaultOn: true,
};
const BETA: SkillEntry = {
  id: "beta",
  label: "Beta",
  summary: "",
  folders: ["beta"],
  defaultOn: true,
};

interface Fixture {
  input(switches: Record<string, boolean>, skills?: readonly SkillEntry[]): SyncInput;
  vendor: string;
  skills: string;
  record: string;
}

async function fixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "default-skills-"));
  roots.push(root);
  const vendor = join(root, "plugin", "vendor");
  // A temp HOME and PASEO_HOME, laid out as the daemon resolves them.
  const skills = join(root, "home", ".claude", "skills");
  const record = join(root, "paseo-home", "default-skills", "installed.json");
  for (const [skill, folder] of [
    ["alpha", "alpha-one"],
    ["alpha", "alpha-two"],
    ["beta", "beta"],
  ] as const) {
    await mkdir(join(vendor, skill, folder, "references"), { recursive: true });
    await writeFile(join(vendor, skill, folder, "SKILL.md"), `# ${folder} v1\n`);
    await writeFile(join(vendor, skill, folder, "references", "notes.md"), `${folder} notes\n`);
  }
  return {
    vendor,
    skills,
    record,
    input: (switches, catalog = [ALPHA, BETA]) => ({
      vendorDirectory: vendor,
      skillsDirectory: skills,
      recordFile: record,
      skills: catalog,
      switches,
    }),
  };
}

function done(status: SyncStatus) {
  if (status.status !== "done") throw new Error(`sync did not finish: ${JSON.stringify(status)}`);
  return status;
}

async function readSkill(skills: string, folder: string): Promise<string> {
  return readFile(join(skills, folder, "SKILL.md"), "utf8");
}

async function exists(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null)) !== null;
}

describe("syncSkills", () => {
  it("installs every folder of an enabled skill and records it as the plugin's", async () => {
    const f = await fixture();

    const status = done(await syncSkills(f.input({ alpha: true, beta: false })));

    expect(status.skills).toEqual([
      {
        id: "alpha",
        folders: [
          { folder: "alpha-one", state: "installed" },
          { folder: "alpha-two", state: "installed" },
        ],
      },
      { id: "beta", folders: [{ folder: "beta", state: "off" }] },
    ]);
    expect(status.recordError).toBeNull();
    expect(await readSkill(f.skills, "alpha-one")).toBe("# alpha-one v1\n");
    expect(await readFile(join(f.skills, "alpha-two", "references", "notes.md"), "utf8")).toBe(
      "alpha-two notes\n",
    );
    expect(await exists(join(f.skills, "beta"))).toBe(false);
    const record = JSON.parse(await readFile(f.record, "utf8"));
    expect(Object.keys(record.folders).sort()).toEqual(["alpha-one", "alpha-two"]);
    // No staging folder is left beside the skills.
    expect((await readdir(f.skills)).sort()).toEqual(["alpha-one", "alpha-two"]);
  });

  it("skips a folder the user made under the same name and leaves it as it was", async () => {
    const f = await fixture();
    await mkdir(join(f.skills, "alpha-one"), { recursive: true });
    await writeFile(join(f.skills, "alpha-one", "SKILL.md"), "mine\n");

    const status = done(await syncSkills(f.input({ alpha: true, beta: true })));

    expect(status.skills[0]?.folders[0]).toEqual({
      folder: "alpha-one",
      state: "skipped",
      reason: "a folder with this name exists",
    });
    expect(status.skills[0]?.folders[1]).toEqual({ folder: "alpha-two", state: "installed" });
    expect(await readSkill(f.skills, "alpha-one")).toBe("mine\n");
  });

  it("replaces its own folder when the vendored content changed", async () => {
    const f = await fixture();
    done(await syncSkills(f.input({ alpha: true, beta: true })));
    await writeFile(join(f.vendor, "alpha", "alpha-one", "SKILL.md"), "# alpha-one v2\n");
    await rm(join(f.vendor, "alpha", "alpha-one", "references"), { recursive: true });

    const status = done(await syncSkills(f.input({ alpha: true, beta: true })));

    expect(status.skills[0]?.folders[0]).toEqual({ folder: "alpha-one", state: "installed" });
    expect(await readSkill(f.skills, "alpha-one")).toBe("# alpha-one v2\n");
    expect(await exists(join(f.skills, "alpha-one", "references"))).toBe(false);
    // The replaced copy is still the plugin's, so switching it off removes it.
    done(await syncSkills(f.input({ alpha: false, beta: true })));
    expect(await exists(join(f.skills, "alpha-one"))).toBe(false);
  });

  it("leaves its own folder in place when nothing changed", async () => {
    const f = await fixture();
    done(await syncSkills(f.input({ alpha: true, beta: true })));
    const before = await stat(join(f.skills, "alpha-one", "SKILL.md"));

    const status = done(await syncSkills(f.input({ alpha: true, beta: true })));

    const after = await stat(join(f.skills, "alpha-one", "SKILL.md"));
    expect(after.ino).toBe(before.ino);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(status.skills[0]?.folders[0]).toEqual({ folder: "alpha-one", state: "installed" });
  });

  it("removes its own folders when a skill is switched off", async () => {
    const f = await fixture();
    done(await syncSkills(f.input({ alpha: true, beta: true })));

    const status = done(await syncSkills(f.input({ alpha: false, beta: true })));

    expect(status.skills[0]?.folders).toEqual([
      { folder: "alpha-one", state: "off" },
      { folder: "alpha-two", state: "off" },
    ]);
    expect((await readdir(f.skills)).sort()).toEqual(["beta"]);
    const record = JSON.parse(await readFile(f.record, "utf8"));
    expect(Object.keys(record.folders)).toEqual(["beta"]);
  });

  it("never touches folders it does not own, on or off", async () => {
    const f = await fixture();
    await mkdir(join(f.skills, "alpha-one"), { recursive: true });
    await writeFile(join(f.skills, "alpha-one", "SKILL.md"), "mine\n");
    await mkdir(join(f.skills, "unrelated"), { recursive: true });
    await writeFile(join(f.skills, "unrelated", "SKILL.md"), "other\n");

    done(await syncSkills(f.input({ alpha: true, beta: true })));
    const status = done(await syncSkills(f.input({ alpha: false, beta: false })));

    expect(status.skills[0]?.folders[0]).toEqual({ folder: "alpha-one", state: "off" });
    expect(await readSkill(f.skills, "alpha-one")).toBe("mine\n");
    expect(await readSkill(f.skills, "unrelated")).toBe("other\n");
    expect((await readdir(f.skills)).sort()).toEqual(["alpha-one", "unrelated"]);
  });

  it("gives up a folder the user edited after it was installed", async () => {
    const f = await fixture();
    done(await syncSkills(f.input({ alpha: true, beta: true })));
    await writeFile(join(f.skills, "alpha-one", "SKILL.md"), "edited\n");

    const on = done(await syncSkills(f.input({ alpha: true, beta: true })));
    const off = done(await syncSkills(f.input({ alpha: false, beta: true })));

    expect(on.skills[0]?.folders[0]).toEqual({
      folder: "alpha-one",
      state: "skipped",
      reason: "a folder with this name exists",
    });
    expect(off.skills[0]?.folders[0]).toEqual({ folder: "alpha-one", state: "off" });
    expect(await readSkill(f.skills, "alpha-one")).toBe("edited\n");
    expect(await exists(join(f.skills, "alpha-two"))).toBe(false);
  });

  it("puts back its own folder when it went missing", async () => {
    const f = await fixture();
    done(await syncSkills(f.input({ alpha: true, beta: true })));
    await rm(join(f.skills, "beta"), { recursive: true });

    done(await syncSkills(f.input({ alpha: true, beta: true })));

    expect(await readSkill(f.skills, "beta")).toBe("# beta v1\n");
  });

  it("removes a folder it owns once the catalog no longer lists it", async () => {
    const f = await fixture();
    done(await syncSkills(f.input({ alpha: true, beta: true })));

    const status = done(await syncSkills(f.input({ alpha: true }, [ALPHA])));

    expect(status.skills.map((skill) => skill.id)).toEqual(["alpha"]);
    expect(await exists(join(f.skills, "beta"))).toBe(false);
  });

  it("reports a failing copy as an error on that folder and still installs the rest", async () => {
    const f = await fixture();
    await rm(join(f.vendor, "alpha", "alpha-two"), { recursive: true });

    const result = syncSkills(f.input({ alpha: true, beta: true }));

    await expect(result).resolves.toBeDefined();
    const status = done(await result);
    const failed = status.skills[0]?.folders[1];
    expect(failed?.state).toBe("error");
    expect(failed?.folder).toBe("alpha-two");
    expect(status.skills[0]?.folders[0]).toEqual({ folder: "alpha-one", state: "installed" });
    expect(status.skills[1]?.folders[0]).toEqual({ folder: "beta", state: "installed" });
    expect((await readdir(f.skills)).sort()).toEqual(["alpha-one", "beta"]);
    const record = JSON.parse(await readFile(f.record, "utf8"));
    expect(Object.keys(record.folders).sort()).toEqual(["alpha-one", "beta"]);
  });

  it("fails without touching any folder when the record is not valid", async () => {
    const f = await fixture();
    done(await syncSkills(f.input({ alpha: true, beta: true })));
    await writeFile(f.record, "{ not json");

    const status = await syncSkills(f.input({ alpha: false, beta: false }));

    expect(status).toEqual({
      status: "failed",
      error: `${f.record} is not valid. Fix it, or delete it: every installed folder then counts as yours.`,
    });
    expect((await readdir(f.skills)).sort()).toEqual(["alpha-one", "alpha-two", "beta"]);
  });
});
