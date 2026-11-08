import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applySetupLink, planSetupLink, setupProblems, type SetupStep } from "./setup-link.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

interface Profiles {
  main: string;
  account: string;
}

async function profiles(): Promise<Profiles> {
  const root = await mkdtemp(join(tmpdir(), "claude-accounts-"));
  roots.push(root);
  const main = join(root, ".claude");
  const account = join(root, ".claude-work");
  await mkdir(join(main, "skills"), { recursive: true });
  await mkdir(join(main, "plugins"));
  await mkdir(join(main, "commands"));
  await writeFile(join(main, "settings.json"), "{}");
  await mkdir(join(account, "commands"), { recursive: true });
  return { main, account };
}

const COMMANDS_KEPT =
  "commands exists in this account's directory, so the main account's commands is not shared";

describe("setup links", () => {
  it("links what the main profile has and the account lacks, and keeps the account's own", async () => {
    const { main, account } = await profiles();

    const plan = await planSetupLink(main, account);
    const expectedPlan: SetupStep[] = [
      { entry: "settings.json", action: "link", target: join(main, "settings.json") },
      { entry: "CLAUDE.md", action: "absent", target: join(main, "CLAUDE.md") },
      { entry: "skills", action: "link", target: join(main, "skills") },
      { entry: "plugins", action: "link", target: join(main, "plugins") },
      { entry: "commands", action: "keep", target: join(main, "commands") },
      { entry: "agents", action: "absent", target: join(main, "agents") },
    ];
    expect(plan).toEqual(expectedPlan);
    expect(setupProblems(plan)).toEqual([
      "settings.json is not shared yet. Add the account again to share it.",
      "skills is not shared yet. Add the account again to share it.",
      "plugins is not shared yet. Add the account again to share it.",
      COMMANDS_KEPT,
    ]);

    const applied = await applySetupLink(plan, account);

    expect(applied.map((step) => step.action)).toEqual([
      "linked",
      "absent",
      "linked",
      "linked",
      "keep",
      "absent",
    ]);
    expect(await readlink(join(account, "settings.json"))).toBe(join(main, "settings.json"));
    expect(await readlink(join(account, "skills"))).toBe(join(main, "skills"));
    expect(await readlink(join(account, "plugins"))).toBe(join(main, "plugins"));
    expect((await lstat(join(account, "commands"))).isDirectory()).toBe(true);
    expect(setupProblems(await planSetupLink(main, account))).toEqual([COMMANDS_KEPT]);
  });

  it("keeps a path that appeared after the plan instead of replacing it", async () => {
    const { main, account } = await profiles();
    const plan = await planSetupLink(main, account);
    await writeFile(join(account, "settings.json"), '{"theme":"dark"}');

    const applied = await applySetupLink(plan, account);

    expect(applied[0]).toEqual({
      entry: "settings.json",
      action: "keep",
      target: join(main, "settings.json"),
    });
    expect(await readFile(join(account, "settings.json"), "utf8")).toBe('{"theme":"dark"}');
  });

  it("counts a link to somewhere else as the account's own", async () => {
    const { main, account } = await profiles();
    await symlink(join(main, "commands"), join(account, "skills"));

    const plan = await planSetupLink(main, account);

    expect(plan[2]).toEqual({ entry: "skills", action: "keep", target: join(main, "skills") });
  });
});
