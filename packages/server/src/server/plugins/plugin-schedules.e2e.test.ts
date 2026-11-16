import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { resolveDaemonVersion } from "../daemon-version.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { BuiltinPluginLoader } from "./builtin/index.js";

const PLUGIN_ID = "scheduler";
const cadence = { type: "every", everyMs: 60_000 } as const;

const pluginSource = `import { defineRpc } from "@getpaseo/plugin";
import { type PluginServerContext } from "@getpaseo/plugin/server";
import { z } from "zod";

const upsert = defineRpc({
  name: "upsert",
  input: z.object({ name: z.string(), handler: z.string() }),
  output: z.object({ id: z.string(), nextRunAt: z.string().nullable() }),
});
const remove = defineRpc({ name: "remove", input: z.object({ name: z.string() }), output: z.boolean() });
const list = defineRpc({ name: "list", input: z.object({}), output: z.array(z.unknown()) });
const runs = defineRpc({ name: "runs", input: z.object({}), output: z.array(z.unknown()) });

export default function contribute(server: PluginServerContext) {
  const recorded: unknown[] = [];
  const kept = server.schedules.upsert({
    name: "n",
    handler: "h",
    prompt: "p",
    cadence: { type: "every", everyMs: 60_000 },
  });
  server.handleSchedule("h", async ({ paseo, scheduleId, runId }) => {
    recorded.push({ api: typeof paseo.agents.list, scheduleId, runId });
  });
  server.handle(upsert, ({ name, handler }) =>
    server.schedules.upsert({ name, handler, prompt: "p", cadence: { type: "every", everyMs: 60_000 } }),
  );
  server.handle(remove, ({ name }) => server.schedules.remove(name));
  server.handle(list, async () => {
    await kept;
    return server.schedules.list();
  });
  server.handle(runs, () => recorded);
  return () => undefined;
}
`;

const ListedScheduleSchema = z.object({
  id: z.string(),
  name: z.string(),
  handler: z.string(),
  cadence: z.unknown(),
  nextRunAt: z.string().nullable(),
});

interface ScheduledPlugin {
  daemon: TestPaseoDaemon;
  client: DaemonClient;
  invoke(method: string, input?: unknown): Promise<unknown>;
  list(): Promise<z.infer<typeof ListedScheduleSchema>[]>;
}

const roots: string[] = [];
const opened: ScheduledPlugin[] = [];

afterEach(async () => {
  for (const plugin of opened.splice(0)) {
    await plugin.client.close().catch(() => undefined);
    await plugin.daemon.close();
  }
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

// A plugin's server runs in its own process; a built-in's runs inside the daemon.
async function startPlugin(kind: "directory" | "built-in"): Promise<ScheduledPlugin> {
  const root = await mkdtemp(path.join(tmpdir(), "paseo-plugin-schedules-"));
  roots.push(root);
  const directory = path.join(root, PLUGIN_ID);
  await mkdir(directory);
  await writeFile(
    path.join(directory, "paseo-plugin.json"),
    JSON.stringify({
      id: PLUGIN_ID,
      requirements: { paseo: `>=${resolveDaemonVersion(import.meta.url)}` },
    }),
  );
  await writeFile(path.join(directory, "index.server.ts"), pluginSource);
  const daemon = await createTestPaseoDaemon(
    kind === "built-in"
      ? { builtinPlugins: new BuiltinPluginLoader(root, [PLUGIN_ID]) }
      : { pluginsEnabled: true },
  );
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
  const invoke = (method: string, input: unknown = {}) =>
    client.invokePluginRpc(PLUGIN_ID, method, input);
  const plugin: ScheduledPlugin = {
    daemon,
    client,
    invoke,
    list: async () => z.array(ListedScheduleSchema).parse(await invoke("list")),
  };
  opened.push(plugin);
  await client.connect();
  if (kind === "directory") await client.installDirectoryPlugin(directory);
  return plugin;
}

describe.each(["directory", "built-in"] as const)("a %s plugin's schedules", (kind) => {
  test("a plugin keeps a schedule and its handler runs with the Paseo API", async () => {
    const plugin = await startPlugin(kind);
    const schedules = plugin.daemon.daemon.scheduleService;
    // Another plugin's schedule of the same name is not this plugin's.
    await schedules.upsertPluginSchedule({
      pluginId: "other",
      name: "n",
      handler: "h",
      prompt: "p",
      cadence,
    });

    const listed = await plugin.list();
    expect(listed).toEqual([
      { id: expect.any(String), name: "n", handler: "h", cadence, nextRunAt: expect.any(String) },
    ]);
    const scheduleId = listed[0]!.id;
    const ran = await schedules.runOnce(scheduleId);

    expect(ran.target).toEqual({ type: "plugin", pluginId: PLUGIN_ID, handler: "h" });
    expect(ran.runs.at(-1)).toMatchObject({ status: "succeeded", error: null });
    expect(await plugin.invoke("runs")).toEqual([
      { api: "function", scheduleId, runId: ran.runs.at(-1)!.id },
    ]);

    expect(await plugin.invoke("remove", { name: "n" })).toBe(true);
    expect(await plugin.list()).toEqual([]);
    expect(await schedules.listPluginSchedules("other")).toHaveLength(1);
  }, 60_000);

  test("a due schedule with no handler registered fails its run", async () => {
    const plugin = await startPlugin(kind);
    const schedules = plugin.daemon.daemon.scheduleService;
    const { id } = z
      .object({ id: z.string() })
      .parse(await plugin.invoke("upsert", { name: "orphan", handler: "missing" }));

    const ran = await schedules.runOnce(id);

    expect(ran.runs.at(-1)).toMatchObject({
      status: "failed",
      error: "Unknown schedule handler: missing",
    });
    expect(ran.status).toBe("active");
  }, 60_000);
});

test("a schedule of a plugin that is not loaded fails its run and stays", async () => {
  const daemon = await createTestPaseoDaemon();
  try {
    const schedules = daemon.daemon.scheduleService;
    const schedule = await schedules.upsertPluginSchedule({
      pluginId: "absent",
      name: "n",
      handler: "h",
      prompt: "p",
      cadence,
    });

    const ran = await schedules.runOnce(schedule.id);

    expect(ran.runs.at(-1)).toMatchObject({
      status: "failed",
      error: "Plugin is not available: absent",
    });
    expect(ran.status).toBe("active");
  } finally {
    await daemon.close();
  }
}, 60_000);
