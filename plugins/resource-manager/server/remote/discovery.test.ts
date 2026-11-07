import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  discoverSshServers,
  expandVariables,
  runsSshMcp,
  serverId,
  type DiscoveryInput,
  type SshServer,
} from "./discovery.js";

interface Fixture {
  configFile: string;
  repo: string;
  worktree: string;
  broken: string;
  bare: string;
  unlisted: string;
}

let root: string;
let fixture: Fixture;

function writeJson(file: string, value: unknown): void {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

// One entry of each kind: ssh-mcp through npx and through a path, a look-alike package, an
// ordinary MCP server, an HTTP entry, and ssh-mcp in a directory Paseo does not list. The repo is
// a folder Claude Code trusts; the other folders are not.
function writeFixture(base: string): Fixture {
  const repo = join(base, "repo");
  const worktree = join(base, "repo-worktree");
  const broken = join(base, "broken");
  const bare = join(base, "bare");
  const unlisted = join(base, "unlisted");
  for (const dir of [repo, worktree, broken, bare, unlisted]) mkdirSync(dir);
  const configFile = join(base, ".claude.json");
  writeJson(configFile, {
    numStartups: 12,
    mcpServers: {
      "prod-box": {
        type: "stdio",
        command: "npx",
        args: [
          "ssh-mcp",
          "-y",
          "--",
          "--host=${PROD_HOST}",
          "--user=ops",
          "--key=~/.ssh/ssh-mcp/id",
        ],
        env: {},
      },
      context7: { command: "npx", args: ["-y", "@upstash/context7-mcp"] },
      remote: { type: "http", url: "https://mcp.example.test/mcp" },
      lookalike: { command: "npx", args: ["-y", "@example/ssh-mcp-server"] },
    },
    projects: {
      [repo]: { hasTrustDialogAccepted: true },
      [worktree]: {
        allowedTools: [],
        mcpServers: {
          "staging-box": {
            command: "/opt/ssh-mcp/bin/ssh-mcp",
            args: ["--host=${STAGING_HOST:-10.0.0.5}", "--user=${STAGING_USER}"],
          },
        },
      },
      [unlisted]: {
        mcpServers: { hidden: { command: "npx", args: ["-y", "ssh-mcp@1.0.7"] } },
      },
      [bare]: "not an object",
    },
  });
  writeJson(join(repo, ".mcp.json"), {
    mcpServers: {
      // Same command, args and env as prod-box: one server, listed under the user config.
      "prod-copy": {
        command: "npx",
        args: [
          "ssh-mcp",
          "-y",
          "--",
          "--host=${PROD_HOST}",
          "--user=ops",
          "--key=~/.ssh/ssh-mcp/id",
        ],
        env: {},
      },
      "db-box": {
        command: "node",
        args: ["/srv/tools/ssh-mcp/build/index.js", "--", "--host=db.internal"],
        env: { SSH_AUTH_SOCK: "/run/agent.sock" },
      },
    },
  });
  // V8's parse error quotes this text ("...command": pass=hunte"...), so a problem that carried
  // the parser's message would contain "pass=".
  writeFileSync(
    join(broken, ".mcp.json"),
    '{ "mcpServers": { "x": { "command": pass=hunter2 } } }',
  );
  return { configFile, repo, worktree, broken, bare, unlisted };
}

function input(env: NodeJS.ProcessEnv): DiscoveryInput {
  return {
    claudeConfigFile: fixture.configFile,
    workspaceDirectories: [fixture.repo, fixture.worktree, fixture.broken, fixture.bare],
    env,
  };
}

function summary(servers: readonly SshServer[]) {
  return servers.map((server) => ({
    name: server.name,
    source: server.source,
    command: server.command,
    args: server.args,
    missingVariables: server.missingVariables,
  }));
}

function skipped(dir: string): string {
  return `${join(dir, ".mcp.json")}: ssh-mcp entries skipped, Claude Code does not trust ${dir}`;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rm-discovery-"));
  fixture = writeFixture(root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("runsSshMcp", () => {
  it("matches the ssh-mcp package or a path segment named ssh-mcp before --", () => {
    const cases: [string, string[], boolean][] = [
      ["npx", ["ssh-mcp", "-y", "--", "--host=h"], true],
      ["npx", ["-y", "ssh-mcp@latest"], true],
      ["/usr/local/bin/ssh-mcp", [], true],
      ["node", ["/opt/ssh-mcp/build/index.js"], true],
      ["npx", ["-y", "@example/ssh-mcp-server"], false],
      ["npx", ["-y", "mcp-ssh"], false],
      ["npx", ["-y", "other", "--key=/home/u/ssh-mcp/id"], false],
      ["node", ["server.js", "--", "/srv/ssh-mcp"], false],
    ];
    expect(cases.map(([command, args]) => runsSshMcp(command, args))).toEqual(
      cases.map(([, , expected]) => expected),
    );
  });
});

describe("expandVariables", () => {
  it("expands set variables and defaults, and records unset ones without a default", () => {
    const missing = new Set<string>();
    const env: NodeJS.ProcessEnv = { HOST: "10.0.0.1", EMPTY: "" };

    expect(expandVariables("--host=${HOST}", env, missing)).toBe("--host=10.0.0.1");
    expect(expandVariables("${PORT:-22}", env, missing)).toBe("22");
    expect(expandVariables("${HOST:-x}", env, missing)).toBe("10.0.0.1");
    expect(expandVariables("[${EMPTY}]", env, missing)).toBe("[]");
    expect(expandVariables("--user=${USER_X}", env, missing)).toBe("--user=");
    expect(expandVariables("$HOST and ${not valid}", env, missing)).toBe("$HOST and ${not valid}");
    expect(expandVariables("${constructor}", env, missing)).toBe("");
    expect([...missing]).toEqual(["USER_X", "constructor"]);
  });
});

describe("serverId", () => {
  it("is 16 hex characters, stable, and different per source and per name", () => {
    const id = serverId("user", "prod-box");

    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(serverId("user", "prod-box")).toBe(id);
    expect(serverId("user", "prod-box2")).not.toBe(id);
    expect(serverId("project:/repo/.mcp.json", "prod-box")).not.toBe(id);
  });
});

describe("discoverSshServers", () => {
  it("finds ssh-mcp entries in user, local and project scope, once each", async () => {
    const discovery = await discoverSshServers(
      input({ PROD_HOST: "10.0.0.1", STAGING_USER: "deploy" }),
    );

    expect(summary(discovery.servers)).toEqual([
      {
        name: "prod-box",
        source: "User config",
        command: "npx",
        args: ["ssh-mcp", "-y", "--", "--host=10.0.0.1", "--user=ops", "--key=~/.ssh/ssh-mcp/id"],
        missingVariables: [],
      },
      {
        name: "db-box",
        source: `${fixture.repo}/.mcp.json`,
        command: "node",
        args: ["/srv/tools/ssh-mcp/build/index.js", "--", "--host=db.internal"],
        missingVariables: [],
      },
      {
        name: "staging-box",
        source: `Local config for ${fixture.worktree}`,
        command: "/opt/ssh-mcp/bin/ssh-mcp",
        args: ["--host=10.0.0.5", "--user=deploy"],
        missingVariables: [],
      },
    ]);
    expect(discovery.servers[0].id).toBe(serverId("user", "prod-box"));
    expect(discovery.servers[1].env).toEqual({ SSH_AUTH_SOCK: "/run/agent.sock" });
    expect(new Set(discovery.servers.map((server) => server.fingerprint)).size).toBe(3);
  });

  it("reports a broken file by path only, never with its content", async () => {
    const discovery = await discoverSshServers(input({ PROD_HOST: "10.0.0.1" }));

    expect(discovery.problems).toEqual([`${join(fixture.broken, ".mcp.json")}: not valid JSON`]);
    expect(discovery.problems.join("\n")).not.toContain("pass=");
  });

  it("keeps a server whose variables are unset, and names them", async () => {
    const discovery = await discoverSshServers(input({}));

    expect(discovery.servers.map((server) => [server.name, server.missingVariables])).toEqual([
      ["prod-box", ["PROD_HOST"]],
      ["db-box", []],
      ["staging-box", ["STAGING_USER"]],
    ]);
  });

  it("changes the fingerprint when an expanded value changes, and keeps the id", async () => {
    const first = await discoverSshServers(input({ PROD_HOST: "10.0.0.1" }));
    const second = await discoverSshServers(input({ PROD_HOST: "10.0.0.2" }));

    expect(second.servers[0].id).toBe(first.servers[0].id);
    expect(second.servers[0].fingerprint).not.toBe(first.servers[0].fingerprint);
  });

  it("is silent about a missing config, and reports one that is not a Claude config", async () => {
    rmSync(fixture.configFile);
    const withoutConfig = await discoverSshServers(input({}));
    // With no config, no folder is trusted: the repo's .mcp.json is skipped too.
    expect(withoutConfig.servers).toEqual([]);
    expect(withoutConfig.problems).toEqual([
      skipped(fixture.repo),
      `${join(fixture.broken, ".mcp.json")}: not valid JSON`,
    ]);

    writeJson(fixture.configFile, { mcpServers: [] });
    const discovery = await discoverSshServers(input({}));
    expect(discovery.problems[0]).toBe(`${fixture.configFile}: not a Claude config`);
  });

  it("keeps entries apart that differ only in which variables are unset", async () => {
    writeJson(join(fixture.repo, ".mcp.json"), {
      mcpServers: {
        "a-box": { command: "npx", args: ["ssh-mcp", "--", "--host=${HOST_A}"] },
        "b-box": { command: "npx", args: ["ssh-mcp", "--", "--host=${HOST_B}"] },
      },
    });

    const discovery = await discoverSshServers(
      input({ PROD_HOST: "10.0.0.1", STAGING_USER: "deploy" }),
    );

    expect(discovery.servers.map((server) => [server.name, server.missingVariables])).toEqual([
      ["prod-box", []],
      ["a-box", ["HOST_A"]],
      ["b-box", ["HOST_B"]],
      ["staging-box", []],
    ]);
  });

  it("expands variables in the command and in env values", async () => {
    writeJson(join(fixture.repo, ".mcp.json"), {
      mcpServers: {
        "tool-box": {
          command: "${TOOLS}/ssh-mcp/bin/ssh-mcp",
          args: ["--host=h"],
          env: { TOKEN: "${T}", PORT: "${PORT:-22}" },
        },
      },
    });

    const discovery = await discoverSshServers(input({ TOOLS: "/opt", T: "t1" }));
    const box = discovery.servers.find((server) => server.name === "tool-box");

    expect(box?.command).toBe("/opt/ssh-mcp/bin/ssh-mcp");
    expect(box?.env).toEqual({ TOKEN: "t1", PORT: "22" });
  });

  it("reports a .mcp.json that cannot be read or is not an MCP config, by path", async () => {
    writeJson(join(fixture.worktree, ".mcp.json"), { mcpServers: [] });
    mkdirSync(join(fixture.bare, ".mcp.json"));

    const discovery = await discoverSshServers(input({}));

    expect(discovery.problems).toEqual([
      `${join(fixture.worktree, ".mcp.json")}: not an MCP config`,
      `${join(fixture.broken, ".mcp.json")}: not valid JSON`,
      `${join(fixture.bare, ".mcp.json")}: unreadable`,
    ]);
  });

  it("reports an unreadable Claude config and still reads the workspaces", async () => {
    rmSync(fixture.configFile);
    mkdirSync(fixture.configFile);

    const discovery = await discoverSshServers(input({}));

    expect(discovery.problems).toEqual([
      `${fixture.configFile}: unreadable`,
      skipped(fixture.repo),
      `${join(fixture.broken, ".mcp.json")}: not valid JSON`,
    ]);
  });

  it("takes a .mcp.json only where Claude Code trusts the folder or a parent", async () => {
    writeJson(join(fixture.worktree, ".mcp.json"), {
      mcpServers: { "w-box": { command: "npx", args: ["ssh-mcp", "--", "--host=w.internal"] } },
    });
    writeJson(join(fixture.bare, ".mcp.json"), {
      mcpServers: { context7: { command: "npx", args: ["-y", "@upstash/context7-mcp"] } },
    });

    const untrusted = await discoverSshServers(
      input({ PROD_HOST: "10.0.0.1", STAGING_USER: "deploy" }),
    );
    expect(untrusted.servers.map((server) => server.name)).toEqual([
      "prod-box",
      "db-box",
      "staging-box",
    ]);
    // The bare folder's .mcp.json has no ssh-mcp entry, so it gets no problem.
    expect(untrusted.problems).toEqual([
      skipped(fixture.worktree),
      `${join(fixture.broken, ".mcp.json")}: not valid JSON`,
    ]);

    writeJson(fixture.configFile, { projects: { [root]: { hasTrustDialogAccepted: true } } });
    const trusted = await discoverSshServers(input({}));
    expect(trusted.servers.map((server) => [server.name, server.source])).toEqual([
      ["prod-copy", join(fixture.repo, ".mcp.json")],
      ["db-box", join(fixture.repo, ".mcp.json")],
      ["w-box", join(fixture.worktree, ".mcp.json")],
    ]);
    expect(trusted.servers[1].id).toBe(
      serverId(`project:${join(fixture.repo, ".mcp.json")}`, "db-box"),
    );
    expect(trusted.problems).toEqual([`${join(fixture.broken, ".mcp.json")}: not valid JSON`]);
  });
});
