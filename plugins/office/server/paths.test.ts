import { expect, test } from "vitest";
import {
  boardsFile,
  hostSkillFolders,
  incidentsFile,
  notesWriterFile,
  officeDir,
  paseoHome,
  workspaceSkillFolders,
} from "./paths.js";

const HOME = "/home/u";

test("defaults PASEO_HOME to ~/.paseo and expands a leading ~/", () => {
  expect(paseoHome({}, HOME)).toBe("/home/u/.paseo");
  expect(paseoHome({ PASEO_HOME: "~/dev-home" }, HOME)).toBe("/home/u/dev-home");
  expect(paseoHome({ PASEO_HOME: "/srv/paseo" }, HOME)).toBe("/srv/paseo");
});

test("keeps the office's files under PASEO_HOME/office", () => {
  const env = { PASEO_HOME: "/srv/paseo" };
  expect(officeDir(env, HOME)).toBe("/srv/paseo/office");
  expect(boardsFile(env, HOME)).toBe("/srv/paseo/office/boards.json");
  expect(notesWriterFile(env, HOME)).toBe("/srv/paseo/office/notes-writer.json");
  expect(incidentsFile(env, HOME)).toBe("/srv/paseo/office/incidents.json");
});

test("reads the host's skills from the Claude config folder and Paseo's two other homes", () => {
  expect(hostSkillFolders({}, HOME)).toEqual([
    { label: ".claude", path: "/home/u/.claude/skills" },
    { label: ".agents", path: "/home/u/.agents/skills" },
    { label: ".codex", path: "/home/u/.codex/skills" },
  ]);
  expect(hostSkillFolders({ CLAUDE_CONFIG_DIR: "~/work-claude" }, HOME)[0]).toEqual({
    label: ".claude",
    path: "/home/u/work-claude/skills",
  });
});

test("reads a workspace's skills from the same three folders inside it", () => {
  expect(workspaceSkillFolders("/repo")).toEqual([
    { label: ".claude", path: "/repo/.claude/skills" },
    { label: ".agents", path: "/repo/.agents/skills" },
    { label: ".codex", path: "/repo/.codex/skills" },
  ]);
});
