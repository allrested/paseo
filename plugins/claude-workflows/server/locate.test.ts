import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  claudeConfigDirs,
  locateRun,
  projectSlug,
  type LocateRunInput,
  type RunLocation,
} from "./locate.js";

const SESSION_ID = "0f8c2d4e-1a2b-4c3d-8e9f-0123456789ab";
/** A session the agent left, after a `/clear` or a restart gave it SESSION_ID. */
const EARLIER_SESSION_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const RUN_ID = "wf_0a1b2c3d-4e5";

let root = "";

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "claude-workflows-locate-")));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** `<configDir>/projects/<project>/<session>/subagents/workflows/<run>`, created. */
async function makeRun(configDir: string, project: string, session = SESSION_ID): Promise<void> {
  const runDir = join(configDir, "projects", project, session, "subagents", "workflows", RUN_ID);
  await mkdir(runDir, { recursive: true });
}

function location(configDir: string, project: string, sessionId = SESSION_ID): RunLocation {
  const sessionDir = join(configDir, "projects", project, sessionId);
  const runDir = join(sessionDir, "subagents", "workflows", RUN_ID);
  return { configDir, sessionDir, runDir, sessionId };
}

describe("claudeConfigDirs", () => {
  it("lists CLAUDE_CONFIG_DIR, ~/.claude, then each ~/.claude-<name> profile by name", async () => {
    const home = join(root, "home");
    const custom = join(root, "custom");
    for (const dir of [
      custom,
      join(home, ".claude"),
      join(home, ".claude-b"),
      join(home, ".claude-a"),
    ]) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(join(home, ".claude.json"), "{}");
    await writeFile(join(home, ".claude-file"), "not a directory");

    await expect(claudeConfigDirs({ home, env: { CLAUDE_CONFIG_DIR: custom } })).resolves.toEqual([
      custom,
      join(home, ".claude"),
      join(home, ".claude-a"),
      join(home, ".claude-b"),
    ]);
  });

  it("lists a profile that CLAUDE_CONFIG_DIR names once", async () => {
    const home = join(root, "home");
    await mkdir(join(home, ".claude"), { recursive: true });
    await mkdir(join(home, ".claude-a"));

    const env = { CLAUDE_CONFIG_DIR: `${join(home, ".claude-a")}/` };
    await expect(claudeConfigDirs({ home, env })).resolves.toEqual([
      join(home, ".claude-a"),
      join(home, ".claude"),
    ]);
  });

  it("has none for a home without Claude dirs", async () => {
    await expect(claudeConfigDirs({ home: join(root, "absent"), env: {} })).resolves.toEqual([]);
  });
});

describe("projectSlug", () => {
  it("encodes the real path of the cwd", async () => {
    await mkdir(join(root, "real", "my project"), { recursive: true });
    await symlink(join(root, "real"), join(root, "link"));

    const expected = join(root, "real", "my project").replace(/[^a-zA-Z0-9]/g, "-");
    await expect(projectSlug(join(root, "link", "my project"))).resolves.toBe(expected);
  });

  it("encodes a missing path as given, cut at 200 characters with a hash", async () => {
    const slug = await projectSlug(`/missing/${"a".repeat(240)}`);
    expect(slug).toMatch(/^-missing-a{191}-[0-9a-z]+$/);
  });
});

describe("locateRun", () => {
  it("finds the run under the cwd's slug", async () => {
    const configDir = join(root, "home", ".claude");
    const cwd = join(root, "project");
    await mkdir(cwd);
    const slug = await projectSlug(cwd);
    await makeRun(configDir, slug);

    const input = { configDirs: [configDir], cwd, sessionId: SESSION_ID, runId: RUN_ID };
    await expect(locateRun(input)).resolves.toEqual(location(configDir, slug));
  });

  it("scans the other project dirs when the slug has no such session", async () => {
    const configDir = join(root, "home", ".claude");
    const cwd = join(root, "project");
    await mkdir(cwd);
    await mkdir(join(configDir, "projects", await projectSlug(cwd)), { recursive: true });
    await mkdir(join(configDir, "projects", "-unrelated"), { recursive: true });
    await makeRun(configDir, "-moved-project");

    const input = { configDirs: [configDir], cwd, sessionId: SESSION_ID, runId: RUN_ID };
    await expect(locateRun(input)).resolves.toEqual(location(configDir, "-moved-project"));
  });

  it("tries each config dir in order", async () => {
    const first = join(root, "home", ".claude");
    const profile = join(root, "home", ".claude-work");
    const cwd = join(root, "project");
    await mkdir(cwd);
    await mkdir(join(first, "projects"), { recursive: true });
    await makeRun(profile, await projectSlug(cwd));

    const input = { configDirs: [first, profile], cwd, sessionId: SESSION_ID, runId: RUN_ID };
    await expect(locateRun(input)).resolves.toEqual(location(profile, await projectSlug(cwd)));
  });

  it("tries the slug's other sessions once no config dir has the run in the current one", async () => {
    const first = join(root, "home", ".claude");
    const profile = join(root, "home", ".claude-work");
    const cwd = join(root, "project");
    await mkdir(cwd);
    const slug = await projectSlug(cwd);
    await mkdir(join(first, "projects", slug, SESSION_ID), { recursive: true });
    await makeRun(first, slug, EARLIER_SESSION_ID);
    const input = { configDirs: [first, profile], cwd, sessionId: SESSION_ID, runId: RUN_ID };

    await expect(locateRun(input)).resolves.toEqual(location(first, slug, EARLIER_SESSION_ID));
    await makeRun(profile, "-moved-project");
    await expect(locateRun(input)).resolves.toEqual(location(profile, "-moved-project"));
  });

  it("finds nothing for a malformed session id or run id", async () => {
    const configDir = join(root, "home", ".claude");
    const cwd = join(root, "project");
    await mkdir(cwd);
    await makeRun(configDir, await projectSlug(cwd));
    const base = { configDirs: [configDir], cwd };

    const cases: LocateRunInput[] = [
      { ...base, sessionId: SESSION_ID.toUpperCase(), runId: RUN_ID },
      { ...base, sessionId: "..", runId: RUN_ID },
      { ...base, sessionId: SESSION_ID, runId: `../${RUN_ID}` },
      { ...base, sessionId: SESSION_ID, runId: "wf_0a1b2c3d" },
    ];
    for (const input of cases) {
      expect(await locateRun(input)).toBeNull();
    }
  });

  it("finds nothing when the run dir resolves outside its config dir", async () => {
    const configDir = join(root, "home", ".claude");
    const cwd = join(root, "project");
    await mkdir(cwd);
    const workflowsDir = join(
      configDir,
      "projects",
      await projectSlug(cwd),
      SESSION_ID,
      "subagents",
      "workflows",
    );
    await mkdir(workflowsDir, { recursive: true });
    await mkdir(join(root, "outside", RUN_ID), { recursive: true });
    await symlink(join(root, "outside", RUN_ID), join(workflowsDir, RUN_ID));

    const input = { configDirs: [configDir], cwd, sessionId: SESSION_ID, runId: RUN_ID };
    await expect(locateRun(input)).resolves.toBeNull();
  });

  it("finds nothing when the run is missing or is a file", async () => {
    const configDir = join(root, "home", ".claude");
    const cwd = join(root, "project");
    await mkdir(cwd);
    const workflowsDir = join(
      configDir,
      "projects",
      await projectSlug(cwd),
      SESSION_ID,
      "subagents",
      "workflows",
    );
    await mkdir(workflowsDir, { recursive: true });
    const input = { configDirs: [configDir], cwd, sessionId: SESSION_ID, runId: RUN_ID };

    await expect(locateRun(input)).resolves.toBeNull();
    await writeFile(join(workflowsDir, RUN_ID), "not a directory");
    await expect(locateRun(input)).resolves.toBeNull();
  });

  it("finds no other session's run outside the slug, in a dir not named as a session, or outside the config dir", async () => {
    const configDir = join(root, "home", ".claude");
    const cwd = join(root, "project");
    await mkdir(cwd);
    const slug = await projectSlug(cwd);
    await makeRun(configDir, "-other-project", EARLIER_SESSION_ID);
    await makeRun(configDir, slug, "memory");
    await mkdir(join(root, "outside", "subagents", "workflows", RUN_ID), { recursive: true });
    await symlink(join(root, "outside"), join(configDir, "projects", slug, EARLIER_SESSION_ID));

    const input = { configDirs: [configDir], cwd, sessionId: SESSION_ID, runId: RUN_ID };
    await expect(locateRun(input)).resolves.toBeNull();
  });
});
