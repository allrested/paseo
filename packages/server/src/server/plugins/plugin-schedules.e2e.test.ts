import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { resolveDaemonVersion } from "../daemon-version.js";
import { ScheduleStore } from "../schedule/store.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { BuiltinPluginLoader, type BuiltinPlugin } from "./builtin/index.js";

const PLUGIN_ID = "scheduler";
// An `every` schedule runs as soon as it is created, so the tick could race the test's own runs.
const cadence = { type: "cron", expression: "0 0 1 1 *" } as const;

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
    cadence: ${JSON.stringify(cadence)},
  });
  server.handleSchedule("h", async ({ paseo, scheduleId, runId }) => {
    recorded.push({ api: typeof paseo.agents.list, scheduleId, runId });
  });
  server.handle(upsert, ({ name, handler }) =>
    server.schedules.upsert({ name, handler, prompt: "p", cadence: ${JSON.stringify(cadence)} }),
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

// The daemon starts built-ins and then configured plugins, so this loader goes first.
class HeldPluginLoader extends BuiltinPluginLoader {
  constructor(
    private readonly beforePlugins: () => Promise<void>,
    root: string,
    list: readonly string[],
  ) {
    super(root, list);
  }

  override async load(start: (plugin: BuiltinPlugin) => Promise<void>): Promise<void> {
    await this.beforePlugins();
    await super.load(start);
  }
}

interface StartPluginOptions {
  paseoHomeRoot?: string;
  /** Runs once the daemon's schedules have started and before any plugin loads. */
  beforePlugins?: () => Promise<void>;
}

// A plugin's server runs in its own process; a built-in's runs inside the daemon.
async function startPlugin(
  kind: "directory" | "built-in",
  options: StartPluginOptions = {},
): Promise<ScheduledPlugin> {
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
  const held = options.beforePlugins ?? (async () => undefined);
  const daemon = await createTestPaseoDaemon({
    paseoHomeRoot: options.paseoHomeRoot,
    ...(kind === "built-in"
      ? { builtinPlugins: new HeldPluginLoader(held, root, [PLUGIN_ID]) }
      : {
          builtinPlugins: new HeldPluginLoader(held, root, []),
          pluginsEnabled: true,
          plugins: { [PLUGIN_ID]: { source: "directory", path: directory, enabled: true } },
        }),
  });
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
  return plugin;
}

async function waitUntil(condition: () => Promise<boolean>): Promise<void> {
  while (!(await condition())) await new Promise((resolve) => setTimeout(resolve, 50));
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

  test("a schedule that comes due while the daemon starts runs once its plugin loads", async () => {
    const paseoHomeRoot = await mkdtemp(path.join(tmpdir(), "paseo-plugin-schedules-home-"));
    roots.push(paseoHomeRoot);
    const store = new ScheduleStore(
      path.join(paseoHomeRoot, ".paseo", "schedules"),
      pino({ level: "silent" }),
    );
    let scheduleId = "";
    // The schedules have started, so the next tick claims this run before any plugin loads.
    async function dueBeforePlugins(): Promise<void> {
      const due = new Date().toISOString();
      const schedule = await store.create({
        name: "due",
        prompt: "p",
        cadence,
        target: { type: "plugin", pluginId: PLUGIN_ID, handler: "h" },
        status: "active",
        createdAt: due,
        updatedAt: due,
        nextRunAt: due,
        lastRunAt: null,
        pausedAt: null,
        expiresAt: null,
        maxRuns: null,
        runs: [],
      });
      scheduleId = schedule.id;
      await waitUntil(async () => ((await store.get(scheduleId))?.runs.length ?? 0) > 0);
    }

    const plugin = await startPlugin(kind, { paseoHomeRoot, beforePlugins: dueBeforePlugins });

    await expect
      .poll(async () => (await store.get(scheduleId))?.runs.at(-1)?.status, { timeout: 20_000 })
      .toBe("succeeded");
    const run = (await store.get(scheduleId))!.runs.at(-1)!;
    expect(await plugin.invoke("runs")).toEqual([{ api: "function", scheduleId, runId: run.id }]);
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
