import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { BuiltinPluginLoader } from "./builtin/index.js";

const directory = fileURLToPath(new URL("./test-fixtures/internal-seam/", import.meta.url));
const fixtureRoot = fileURLToPath(new URL("./test-fixtures/", import.meta.url));

test("built-in and directory plugins share RPC and lifecycle behavior while built-ins stay hidden and enabled", async () => {
  const workspaceDirectory = await mkdtemp(path.join(tmpdir(), "paseo-internal-seam-"));
  const daemon = await createTestPaseoDaemon({
    daemonVersion: "0.8.0",
    pluginsEnabled: false,
    builtinPlugins: new BuiltinPluginLoader(fixtureRoot, ["internal-seam"]),
  });
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws`, appVersion: "0.8.0" });
  try {
    await client.connect();
    expect(await client.listPlugins()).toEqual([]);
    expect(await client.invokePluginRpc("internal-seam", "state", {})).toEqual({ workspaces: 0 });
    expect((await client.getPluginLogs("internal-seam")).map(({ message }) => message)).toContain(
      "[paseo] Plugin ready",
    );
    await client.patchDaemonConfig({ pluginsEnabled: true });
    await client.installDirectoryPlugin(directory, "directory-seam");
    expect((await client.listPlugins()).map(({ id }) => id)).toEqual(["directory-seam"]);
    expect(await client.invokePluginRpc("directory-seam", "state", {})).toEqual({ workspaces: 0 });
    await client.createWorkspace({
      idempotencyKey: "internal-seam-workspace",
      source: { kind: "directory", path: workspaceDirectory },
    });
    await expect
      .poll(() => client.invokePluginRpc("internal-seam", "state", {}))
      .toEqual({ workspaces: 1 });
    await expect
      .poll(() => client.invokePluginRpc("directory-seam", "state", {}))
      .toEqual({ workspaces: 1 });
    await client.patchDaemonConfig({ pluginsEnabled: false });
    expect(await client.invokePluginRpc("internal-seam", "state", {})).toEqual({ workspaces: 1 });
    expect(await client.listPlugins()).toMatchObject([
      { id: "directory-seam", status: "disabled" },
    ]);
  } finally {
    await client.close();
    await daemon.close();
    await rm(workspaceDirectory, { recursive: true, force: true });
  }
}, 60_000);

test("a failing built-in does not stop the daemon or the next built-in", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "paseo-builtin-failure-"));
  const failingDirectory = path.join(root, "failing-builtin");
  await mkdir(failingDirectory);
  await writeFile(
    path.join(failingDirectory, "paseo-plugin.json"),
    JSON.stringify({ id: "failing-builtin", requirements: { paseo: ">=0.8.0" } }),
  );
  await writeFile(
    path.join(failingDirectory, "index.server.ts"),
    "export default function contribute() { throw new Error('fixture startup failure'); }",
  );
  await cp(directory, path.join(root, "internal-seam"), { recursive: true });
  const daemon = await createTestPaseoDaemon({
    daemonVersion: "0.8.0",
    pluginsEnabled: false,
    builtinPlugins: new BuiltinPluginLoader(root, ["failing-builtin", "internal-seam"]),
  });
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws`, appVersion: "0.8.0" });
  try {
    await client.connect();
    expect(await client.invokePluginRpc("internal-seam", "state", {})).toEqual({ workspaces: 0 });
    expect(await client.listPlugins()).toEqual([]);
  } finally {
    await client.close();
    await daemon.close();
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);

// Fork delta (office stream).
test("a built-in receives the daemon's extras beside its directory, and a directory plugin none", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "paseo-builtin-extras-"));
  const source = [
    'import { defineRpc } from "@getpaseo/plugin";',
    'import { z } from "zod";',
    'const extras = defineRpc({ name: "extras", input: z.object({}), output: z.object({',
    "  directory: z.boolean(), bundle: z.boolean(), pages: z.boolean() }) });",
    "export default function contribute(server, builtin) {",
    "  server.handle(extras, () => ({",
    '    directory: typeof builtin?.directory === "string",',
    '    bundle: typeof builtin?.bundleBrowserScript === "function",',
    "    pages: builtin?.offscreenPages !== undefined,",
    "  }));",
    "  return () => {};",
    "}",
  ].join("\n");
  for (const id of ["extras-builtin", "extras-directory"]) {
    await mkdir(path.join(root, id));
    await writeFile(
      path.join(root, id, "paseo-plugin.json"),
      JSON.stringify({ id, requirements: { paseo: ">=0.8.0" } }),
    );
    await writeFile(path.join(root, id, "index.server.ts"), source);
  }
  const daemon = await createTestPaseoDaemon({
    daemonVersion: "0.8.0",
    pluginsEnabled: true,
    builtinPlugins: new BuiltinPluginLoader(root, ["extras-builtin"]),
  });
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws`, appVersion: "0.8.0" });
  try {
    await client.connect();
    // The test daemon has no Chromium, so it has a bundler and no pages.
    expect(await client.invokePluginRpc("extras-builtin", "extras", {})).toEqual({
      directory: true,
      bundle: true,
      pages: false,
    });
    await client.installDirectoryPlugin(path.join(root, "extras-directory"));
    expect(await client.invokePluginRpc("extras-directory", "extras", {})).toEqual({
      directory: false,
      bundle: false,
      pages: false,
    });
  } finally {
    await client.close();
    await daemon.close();
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
