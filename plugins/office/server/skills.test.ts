import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { SkillFolder } from "./paths.js";
import {
  DESCRIPTION_MAX,
  mergeSkills,
  nodeSkillFiles,
  parseSkill,
  readSkillFolder,
  readSkills,
  SKILLS_PER_FOLDER,
  type SkillsPorts,
} from "./skills.js";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "office-skills-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function skill(folder: string, name: string, text: string | null): Promise<void> {
  await mkdir(join(folder, name), { recursive: true });
  if (text !== null) await writeFile(join(folder, name, "SKILL.md"), text);
}

test("a skill's name and description come from its front matter", () => {
  expect(
    parseSkill(
      "release",
      "---\nname: cut-release\ndescription: Cuts a beta. Use when asked.\n---\n# Body",
    ),
  ).toEqual({ name: "cut-release", description: "Cuts a beta. Use when asked." });
  expect(parseSkill("x", "---\r\nname: 'quoted'\r\ndescription: \"Said so\"\r\n---\r\n")).toEqual({
    name: "quoted",
    description: "Said so",
  });
});

test("a folded or literal description is joined onto one line", () => {
  const text = [
    "---",
    "name: long",
    "description: >",
    "  Writes the notes",
    "  for a release.",
    "metadata:",
    "  version: 2",
    "---",
  ].join("\n");
  expect(parseSkill("long", text)).toEqual({
    name: "long",
    description: "Writes the notes for a release.",
  });
});

test("without front matter the folder names the skill and there is no description", () => {
  expect(parseSkill("notes", "# Notes\nname: not front matter")).toEqual({
    name: "notes",
    description: null,
  });
  // (front matter that never closes, as in a head cut short, counts as none)
  expect(parseSkill("cut", "---\nname: cut\ndescription: half")).toEqual({
    name: "cut",
    description: null,
  });
});

test("a long description is cut, and an empty one is none", () => {
  const long = parseSkill("a", `---\ndescription: ${"word ".repeat(100)}\n---`);
  expect(long.description?.length).toBe(DESCRIPTION_MAX);
  expect(long.description?.endsWith("…")).toBe(true);
  expect(parseSkill("b", "---\nname: b\ndescription:\n---").description).toBeNull();
});

test("a folder's skills are its folders with a SKILL.md, by name, hidden ones left out", async () => {
  const folder = join(root, "skills");
  await skill(folder, "zeta", "---\nname: zeta\ndescription: Last.\n---");
  await skill(folder, "alpha", "---\nname: alpha\ndescription: First.\n---");
  await skill(folder, "empty", null);
  await skill(folder, ".hidden", "---\nname: hidden\n---");
  await writeFile(join(folder, "README.md"), "not a skill");
  // (a linked skill is a skill, as claude-accounts links the main profile's)
  await skill(join(root, "elsewhere"), "linked", "---\nname: linked\n---");
  await symlink(join(root, "elsewhere", "linked"), join(folder, "linked"));
  await symlink(join(root, "gone"), join(folder, "broken"));

  expect(await readSkillFolder(nodeSkillFiles, folder)).toEqual([
    { name: "alpha", description: "First." },
    { name: "linked", description: null },
    { name: "zeta", description: "Last." },
  ]);
});

test("a folder that does not exist has no skills, and a folder keeps at most its cap", async () => {
  expect(await readSkillFolder(nodeSkillFiles, join(root, "nothing"))).toEqual([]);
  const folder = join(root, "many");
  for (let index = 0; index < SKILLS_PER_FOLDER + 2; index += 1) {
    await skill(folder, `s${String(index).padStart(3, "0")}`, "---\ndescription: d\n---");
  }
  const found = await readSkillFolder(nodeSkillFiles, folder);
  expect(found).toHaveLength(SKILLS_PER_FOLDER);
  expect(found.at(-1)?.name).toBe("s099");
});

test("one row per name, with every folder it is in, by name", () => {
  expect(
    mergeSkills([
      { label: ".claude", skills: [{ name: "paseo", description: "Runs agents." }] },
      {
        label: ".agents",
        skills: [
          { name: "paseo", description: "Another copy." },
          { name: "brainstorm", description: null },
        ],
      },
    ]),
  ).toEqual([
    { name: "brainstorm", description: null, folders: [".agents"] },
    { name: "paseo", description: "Runs agents.", folders: [".claude", ".agents"] },
  ]);
});

function ports(patch: Partial<SkillsPorts> = {}): SkillsPorts & { logs: string[] } {
  const logs: string[] = [];
  return {
    files: nodeSkillFiles,
    hostFolders: [
      { label: ".claude", path: join(root, "home", ".claude", "skills") },
      { label: ".agents", path: join(root, "home", ".agents", "skills") },
    ],
    workspaceIds: () => ["w1", "w2", "w3"],
    workspaceFolder: async (id) => {
      if (id === "w3") throw new Error("no such workspace");
      return id === "w1" ? join(root, "repo") : null;
    },
    now: () => Date.parse("2026-11-16T10:00:00.000Z"),
    log: (message) => void logs.push(message),
    logs,
    ...patch,
  };
}

test("reads the host's folders and every workspace's, and says when", async () => {
  await skill(join(root, "home", ".claude", "skills"), "paseo", "---\ndescription: Host.\n---");
  await skill(join(root, "home", ".agents", "skills"), "paseo", "---\ndescription: Copy.\n---");
  await skill(join(root, "repo", ".claude", "skills"), "release", "---\ndescription: Repo.\n---");
  const read = ports();

  expect(await readSkills(read)).toEqual({
    host: [{ name: "paseo", description: "Host.", folders: [".claude", ".agents"] }],
    // (w2 has no folder and w3 could not be looked up: neither has skills of its own)
    workspaces: { w1: [{ name: "release", description: "Repo.", folders: [".claude"] }] },
    readAt: "2026-11-16T10:00:00.000Z",
  });
  expect(read.logs).toEqual(["[office] skills of workspace w3 not read: no such workspace"]);
});

test("a folder that cannot be read is skipped and logged; the rest are listed", async () => {
  await skill(join(root, "home", ".agents", "skills"), "kept", "---\ndescription: Here.\n---");
  const failing: SkillFolder = { label: ".claude", path: join(root, "locked") };
  const read = ports({
    hostFolders: [failing, { label: ".agents", path: join(root, "home", ".agents", "skills") }],
    workspaceIds: () => [],
    files: {
      folders: async (path) => {
        if (path === failing.path) throw new Error("EACCES: permission denied");
        return nodeSkillFiles.folders(path);
      },
      head: nodeSkillFiles.head,
    },
  });

  const result = await readSkills(read);

  expect(result.host).toEqual([{ name: "kept", description: "Here.", folders: [".agents"] }]);
  expect(read.logs).toEqual([
    `[office] skills in ${failing.path} not read: EACCES: permission denied`,
  ]);
});
