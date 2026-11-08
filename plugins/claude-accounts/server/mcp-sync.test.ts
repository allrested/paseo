import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withConfigLock, writeClaudeConfig } from "./claude-config.js";
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

  it("repeats the pass on its timer, reports a thrown sync once, and stops its timer", async () => {
    const { mainFile, accountFile } = await files();
    const goneFile = join(dirname(mainFile), ".claude-gone", ".claude.json");
    await writeJson(mainFile, { mcpServers: SERVERS });
    const targets: SyncTarget[] = [
      { provider: "claude-work", mainFile, accountFile },
      { provider: "claude-gone", mainFile, accountFile: goneFile },
    ];
    const logged: string[] = [];
    const watcher = watchMcpServers({
      targets: async () => targets,
      intervalMs: 20,
      logError: (message) => logged.push(message),
    });
    watchers.push(watcher);

    await vi.waitFor(async () => {
      expect(await readJson(accountFile)).toEqual({ mcpServers: SERVERS });
    });
    await writeJson(mainFile, { mcpServers: { context7: CONTEXT7 } });
    await vi.waitFor(async () => {
      expect(await readJson(accountFile)).toEqual({ mcpServers: { context7: CONTEXT7 } });
    });
    // A full pass after the one in flight, so the problems below come from a finished pass.
    await watcher.tick();
    expect(watcher.problem("claude-gone")).toBe(
      `MCP servers were not copied: ENOENT: no such file or directory, mkdir '${goneFile}.lock'`,
    );
    expect(logged).toEqual(["claude-accounts: copying MCP servers into claude-gone failed"]);

    await watcher.stop();
    await writeJson(mainFile, { mcpServers: SERVERS });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await readJson(accountFile)).toEqual({ mcpServers: { context7: CONTEXT7 } });
  });

  it("stops only after the pass in flight", async () => {
    const { mainFile, accountFile } = await files();
    await writeJson(mainFile, { mcpServers: SERVERS });
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const logged: string[] = [];
    const watcher = watchMcpServers({
      targets: async () => {
        await held;
        return [{ provider: "claude-work", mainFile, accountFile }];
      },
      intervalMs: 60_000,
      logError: (message) => logged.push(message),
    });
    watchers.push(watcher);

    let stopped = false;
    const stopping = watcher.stop().then(() => {
      stopped = true;
      return undefined;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(stopped).toBe(false);
    release();
    await stopping;
    expect(await readJson(accountFile)).toEqual({ mcpServers: SERVERS });
    expect(logged).toEqual([]);
  });

  it("runs no pass once stopped, even when asked for one", async () => {
    const { mainFile, accountFile } = await files();
    await writeJson(mainFile, { mcpServers: SERVERS });
    let passes = 0;
    const watcher = watchMcpServers({
      targets: async () => {
        passes += 1;
        return [{ provider: "claude-work", mainFile, accountFile }];
      },
      intervalMs: 60_000,
      logError: () => undefined,
    });
    watchers.push(watcher);
    await watcher.stop();
    await writeJson(mainFile, { mcpServers: { context7: CONTEXT7 } });

    // An Add account that outlives stop() still calls syncNow, which is tick.
    await watcher.tick();

    expect(passes).toBe(1);
    expect(await readJson(accountFile)).toEqual({ mcpServers: SERVERS });
  });
});

describe("config writes", () => {
  it("removes its temp file when the write fails", async () => {
    const { accountFile } = await files();
    // A directory in the file's place makes the rename fail after the temp file is written.
    await mkdir(accountFile);

    await expect(writeClaudeConfig(accountFile, { mcpServers: SERVERS }, 0o600)).rejects.toThrow();

    expect(await readdir(dirname(accountFile))).toEqual([".claude.json"]);
  });

  it("removes its own lock when the locked work throws", async () => {
    const { accountFile } = await files();

    await expect(
      withConfigLock(accountFile, () => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");

    await expect(stat(`${accountFile}.lock`)).rejects.toThrow("ENOENT");
  });
});
