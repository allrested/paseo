import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { syncMcpServers, watchMcpServers, type McpWatcher, type SyncTarget } from "./mcp-sync.js";

/** A user-scope MCP server as Claude Code stores it; the plugin copies these as opaque JSON. */
interface McpServerFixture {
  type: string;
  url: string;
  headers?: Record<string, string>;
}

const CONTEXT7: McpServerFixture = { type: "http", url: "http://127.0.0.1:8932/mcp" };
const GITLAB: McpServerFixture = {
  type: "http",
  url: "http://127.0.0.1:8933/mcp",
  headers: { Authorization: "Bearer fixture-not-a-token" },
};
const SERVERS: Record<string, McpServerFixture> = { context7: CONTEXT7, gitlab: GITLAB };
const STALE_LOCK =
  ".claude.json.lock is older than a minute, so MCP servers are not copied. Remove it if no Claude Code process uses this account.";

const roots: string[] = [];
const watchers: McpWatcher[] = [];

afterEach(async () => {
  await Promise.all(watchers.splice(0).map((watcher) => watcher.stop()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

interface Files {
  mainFile: string;
  accountFile: string;
}

async function files(): Promise<Files> {
  const root = await mkdtemp(join(tmpdir(), "claude-accounts-"));
  roots.push(root);
  await mkdir(join(root, ".claude-work"));
  return {
    mainFile: join(root, ".claude.json"),
    accountFile: join(root, ".claude-work", ".claude.json"),
  };
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, JSON.stringify(value));
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8"));
}

async function ageLock(lock: string): Promise<void> {
  const twoMinutesAgo = new Date(Date.now() - 120_000);
  await utimes(lock, twoMinutesAgo, twoMinutesAgo);
}

describe("syncMcpServers", () => {
  it("creates a missing account file holding only mcpServers, with mode 0600", async () => {
    const { mainFile, accountFile } = await files();
    await writeJson(mainFile, { numStartups: 9, mcpServers: SERVERS });

    expect(await syncMcpServers(mainFile, accountFile)).toEqual({ status: "copied" });

    expect(await readJson(accountFile)).toEqual({ mcpServers: SERVERS });
    expect((await stat(accountFile)).mode & 0o777).toBe(0o600);
  });

  it("replaces mcpServers in place and keeps every other key and the file mode", async () => {
    const { mainFile, accountFile } = await files();
    await writeJson(mainFile, { mcpServers: SERVERS });
    await writeJson(accountFile, {
      numStartups: 3,
      mcpServers: { old: CONTEXT7 },
      projects: { "/repo": { allowedTools: [] } },
    });
    await chmod(accountFile, 0o644);

    expect(await syncMcpServers(mainFile, accountFile)).toEqual({ status: "copied" });

    const written = await readJson(accountFile);
    expect(written).toEqual({
      numStartups: 3,
      mcpServers: SERVERS,
      projects: { "/repo": { allowedTools: [] } },
    });
    expect(Object.keys(Object(written))).toEqual(["numStartups", "mcpServers", "projects"]);
    expect((await stat(accountFile)).mode & 0o777).toBe(0o644);
  });

  it("leaves an equal copy alone even when its keys are in another order", async () => {
    const { mainFile, accountFile } = await files();
    await writeJson(mainFile, { mcpServers: SERVERS });
    await writeJson(accountFile, {
      mcpServers: {
        gitlab: { headers: GITLAB.headers, url: GITLAB.url, type: "http" },
        context7: CONTEXT7,
      },
    });
    const before = await stat(accountFile);

    expect(await syncMcpServers(mainFile, accountFile)).toEqual({ status: "same" });

    expect((await stat(accountFile)).ino).toBe(before.ino);
  });

  it("removes the account's mcpServers when the main profile has none", async () => {
    const { mainFile, accountFile } = await files();
    await writeJson(mainFile, { numStartups: 1 });
    await writeJson(accountFile, { theme: "dark", mcpServers: SERVERS });

    expect(await syncMcpServers(mainFile, accountFile)).toEqual({ status: "copied" });

    expect(await readJson(accountFile)).toEqual({ theme: "dark" });
  });

  it("does nothing while the main file is missing, and reports one it cannot read", async () => {
    const { mainFile, accountFile } = await files();

    expect(await syncMcpServers(mainFile, accountFile)).toEqual({
      status: "skipped",
      problem: null,
    });
    await writeFile(mainFile, "{");
    expect(await syncMcpServers(mainFile, accountFile)).toEqual({
      status: "skipped",
      problem:
        "The main account's .claude.json is not a valid JSON object, so MCP servers are not copied",
    });

    await expect(stat(accountFile)).rejects.toThrow("ENOENT");
  });

  it("never writes through a symbolic link or over a file that is not a JSON object", async () => {
    const { mainFile, accountFile } = await files();
    await writeJson(mainFile, { mcpServers: SERVERS });
    const elsewhere = `${mainFile}.elsewhere`;
    await writeJson(elsewhere, { mcpServers: {} });
    await symlink(elsewhere, accountFile);

    expect(await syncMcpServers(mainFile, accountFile)).toEqual({
      status: "skipped",
      problem: ".claude.json is a symbolic link, so MCP servers are not copied into it",
    });
    expect(await readJson(elsewhere)).toEqual({ mcpServers: {} });

    await rm(accountFile);
    await writeFile(accountFile, "[]");
    expect(await syncMcpServers(mainFile, accountFile)).toEqual({
      status: "skipped",
      problem: ".claude.json is not a valid JSON object, so MCP servers are not copied into it",
    });
    expect(await readFile(accountFile, "utf8")).toBe("[]");
  });

  it("waits for Claude Code's lock and reports a stale one without removing it", async () => {
    const { mainFile, accountFile } = await files();
    await writeJson(mainFile, { mcpServers: SERVERS });
    await writeJson(accountFile, { mcpServers: {} });
    const lock = `${accountFile}.lock`;
    await mkdir(lock);

    expect(await syncMcpServers(mainFile, accountFile)).toEqual({
      status: "skipped",
      problem: null,
    });
    await ageLock(lock);
    expect(await syncMcpServers(mainFile, accountFile)).toEqual({
      status: "skipped",
      problem: STALE_LOCK,
    });

    expect((await stat(lock)).isDirectory()).toBe(true);
    expect(await readJson(accountFile)).toEqual({ mcpServers: {} });
  });
});

describe("watchMcpServers", () => {
  it("copies on every pass, reports problems per account and logs a failure once", async () => {
    const { mainFile, accountFile } = await files();
    await writeJson(mainFile, { mcpServers: SERVERS });
    const targets: SyncTarget[] = [{ provider: "claude-work", mainFile, accountFile }];
    const logged: string[] = [];
    let recordReadable = true;
    const watcher = watchMcpServers({
      targets: async () => {
        if (!recordReadable) throw new Error("added.json is not valid");
        return targets;
      },
      intervalMs: 60_000,
      logError: (message) => logged.push(message),
    });
    watchers.push(watcher);

    await watcher.tick();
    expect(await readJson(accountFile)).toEqual({ mcpServers: SERVERS });

    await writeJson(mainFile, { mcpServers: { context7: CONTEXT7 } });
    await watcher.tick();
    expect(await readJson(accountFile)).toEqual({ mcpServers: { context7: CONTEXT7 } });

    const lock = `${accountFile}.lock`;
    await mkdir(lock);
    await ageLock(lock);
    await writeJson(mainFile, { mcpServers: SERVERS });
    await watcher.tick();
    expect(watcher.problem("claude-work")).toBe(STALE_LOCK);
    expect(watcher.problem("claude-team")).toBeNull();

    recordReadable = false;
    await watcher.tick();
    await watcher.tick();
    expect(logged).toEqual(["claude-accounts: the MCP server sync failed"]);
  });
});
