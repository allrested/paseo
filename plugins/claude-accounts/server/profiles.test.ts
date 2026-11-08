import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  claudeConfigFile,
  discoverProfiles,
  profilePaths,
  readAddedAccounts,
  recordAddedAccount,
  type ProfilePaths,
  type Profiles,
} from "./profiles.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function tempHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "claude-accounts-"));
  roots.push(home);
  return home;
}

function invalidRecord(recordFile: string): string {
  return `${recordFile} is not valid. Fix it, or delete it and add the accounts again.`;
}

describe("profilePaths", () => {
  it("uses ~/.claude and ~/.paseo when the daemon sets neither variable", () => {
    const expected: ProfilePaths = {
      home: "/home/u",
      mainDirectory: "/home/u/.claude",
      mainViaEnv: false,
      recordFile: "/home/u/.paseo/claude-accounts/added.json",
    };
    expect(profilePaths({}, "/home/u")).toEqual(expected);
  });

  it("follows the daemon's CLAUDE_CONFIG_DIR and PASEO_HOME", () => {
    const expected: ProfilePaths = {
      home: "/home/u",
      mainDirectory: "/srv/claude",
      mainViaEnv: true,
      recordFile: "/home/u/dev/paseo-home/claude-accounts/added.json",
    };
    const env: NodeJS.ProcessEnv = {
      CLAUDE_CONFIG_DIR: "/srv/claude",
      PASEO_HOME: "~/dev/paseo-home",
    };
    expect(profilePaths(env, "/home/u")).toEqual(expected);
  });
});

describe("discoverProfiles", () => {
  it("lists the main profile and the account directories by name", async () => {
    const home = await tempHome();
    await mkdir(join(home, ".claude"));
    await mkdir(join(home, ".claude-work"));
    await writeFile(join(home, ".claude-work", ".credentials.json"), "{}");
    await mkdir(join(home, ".claude-team-2"));
    await mkdir(join(home, ".claude-Bad"));
    await writeFile(join(home, ".claude-file"), "");
    await symlink(join(home, ".claude-work"), join(home, ".claude-linked"));

    const expected: Profiles = {
      main: {
        name: null,
        provider: "claude",
        directory: join(home, ".claude"),
        main: true,
        viaEnv: false,
        credentials: false,
        added: false,
      },
      accounts: [
        {
          name: "linked",
          provider: "claude-linked",
          directory: join(home, ".claude-linked"),
          main: false,
          viaEnv: true,
          credentials: true,
          added: false,
        },
        {
          name: "team-2",
          provider: "claude-team-2",
          directory: join(home, ".claude-team-2"),
          main: false,
          viaEnv: true,
          credentials: false,
          added: false,
        },
        {
          name: "work",
          provider: "claude-work",
          directory: join(home, ".claude-work"),
          main: false,
          viaEnv: true,
          credentials: true,
          added: true,
        },
      ],
    };
    expect(await discoverProfiles(profilePaths({}, home), ["work"])).toEqual(expected);
  });

  it("treats the daemon's CLAUDE_CONFIG_DIR as the main profile, never as an account", async () => {
    const home = await tempHome();
    await mkdir(join(home, ".claude-main"));
    await mkdir(join(home, ".claude-work"));
    const paths = profilePaths({ CLAUDE_CONFIG_DIR: join(home, ".claude-main") }, home);

    const { main, accounts } = await discoverProfiles(paths, []);

    expect(main.directory).toBe(join(home, ".claude-main"));
    expect(main.viaEnv).toBe(true);
    expect(accounts.map((account) => account.provider)).toEqual(["claude-work"]);
  });
});

describe("claudeConfigFile", () => {
  it("follows Claude Code's rule for the global config file", async () => {
    const home = await tempHome();
    const account = join(home, ".claude-work");
    await mkdir(account);

    expect(await claudeConfigFile({ directory: join(home, ".claude"), viaEnv: false }, home)).toBe(
      join(home, ".claude.json"),
    );
    expect(await claudeConfigFile({ directory: account, viaEnv: true }, home)).toBe(
      join(account, ".claude.json"),
    );
    await writeFile(join(account, ".config.json"), "{}");
    expect(await claudeConfigFile({ directory: account, viaEnv: true }, home)).toBe(
      join(account, ".config.json"),
    );
  });
});

describe("the added-accounts record", () => {
  it("reads a missing record as no accounts", async () => {
    const home = await tempHome();
    expect(await readAddedAccounts(join(home, "paseo", "claude-accounts", "added.json"))).toEqual(
      [],
    );
  });

  it("writes sorted names once, with mode 0600 inside a 0700 directory", async () => {
    const home = await tempHome();
    const recordFile = join(home, "paseo", "claude-accounts", "added.json");

    await recordAddedAccount(recordFile, "work");
    await recordAddedAccount(recordFile, "team");
    await recordAddedAccount(recordFile, "work");

    expect(await readAddedAccounts(recordFile)).toEqual(["team", "work"]);
    expect(JSON.parse(await readFile(recordFile, "utf8"))).toEqual({
      version: 1,
      names: ["team", "work"],
    });
    expect((await stat(recordFile)).mode & 0o777).toBe(0o600);
    expect((await stat(join(home, "paseo", "claude-accounts"))).mode & 0o777).toBe(0o700);
  });

  it("refuses a record that is not valid JSON or names an invalid account", async () => {
    const home = await tempHome();
    const recordFile = join(home, "added.json");

    await writeFile(recordFile, "{ not json");
    await expect(readAddedAccounts(recordFile)).rejects.toThrow(invalidRecord(recordFile));
    await writeFile(recordFile, JSON.stringify({ version: 1, names: ["../x"] }));
    await expect(readAddedAccounts(recordFile)).rejects.toThrow(invalidRecord(recordFile));
  });
});
