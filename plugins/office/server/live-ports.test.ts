import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { liveAgentPorts, liveNotesPorts } from "./live-ports.js";
import type { PaseoHolder } from "./paseo-holder.js";

interface FakeAgent {
  id: string;
  status: string;
  archivedAt: string | null;
  pendingPermissions: unknown[];
}

function agent(id: string, overrides: Partial<FakeAgent> = {}): FakeAgent {
  return { id, status: "idle", archivedAt: null, pendingPermissions: [], ...overrides };
}

/** The daemon finds an agent by its id or by a start of it, archived agents too. */
const KNOWN = new Map([
  ["b-full-id", agent("b-full-id")],
  ["b-fu", agent("b-full-id")],
  ["run", agent("run", { status: "running" })],
  ["old", agent("old", { archivedAt: "2026-11-10T08:00:00.000Z" })],
  ["shut", agent("shut", { status: "closed" })],
]);

interface Sent {
  agentId: string;
  text: string;
  options: unknown;
}

/** The daemon's API as the office holds it: the agents of KNOWN, and a record of every send. */
function fakeHolder(sent: Sent[]): PaseoHolder {
  const paseo = {
    agents: {
      ref: (agentId: string) => ({
        refresh: async () => {
          const found = KNOWN.get(agentId);
          return found ? { agent: found, project: null } : null;
        },
        send: async (text: string, options?: unknown) => {
          sent.push({ agentId, text, options });
        },
      }),
    },
  };
  return { remember: () => undefined, require: () => paseo };
}

function setup() {
  const sent: Sent[] = [];
  return { ports: liveAgentPorts(fakeHolder(sent)), sent };
}

test("an agent's wake state is read from the daemon; one it does not know is gone", async () => {
  const { ports } = setup();
  expect(await ports.status("b-full-id")).toBe("wakeable");
  expect(await ports.status("run")).toBe("busy");
  expect(await ports.status("old")).toBe("gone");
  expect(await ports.status("nobody")).toBe("gone");
});

test("a start of an id resolves to the full id; an agent that can get no post resolves to none", async () => {
  const { ports } = setup();
  expect(await ports.resolve("b-fu")).toBe("b-full-id");
  expect(await ports.resolve("run")).toBe("run");
  expect(await ports.resolve("nobody")).toBeNull();
  // The queue drops posts for archived and closed agents unsent, so a post may not name one.
  expect(await ports.resolve("old")).toBeNull();
  expect(await ports.resolve("shut")).toBeNull();
});

test("a wake names its source agent; a wake as from the user names none and never cuts a turn", async () => {
  const { ports, sent } = setup();
  await ports.send("b-full-id", "Office board: 1 post(s) for you.", "a");
  await ports.send("b-full-id", "Office board: 2 post(s) for you.", null);
  expect(sent).toEqual([
    {
      agentId: "b-full-id",
      text: "Office board: 1 post(s) for you.",
      options: { sourceAgentId: "a" },
    },
    {
      agentId: "b-full-id",
      text: "Office board: 2 post(s) for you.",
      options: { activeTurnBehavior: "steer" },
    },
  ]);
});

interface Created {
  cwd: string;
  options: unknown;
}

interface ProviderEntry {
  provider: string;
  status: string;
  enabled: boolean;
  defaultModeId?: string | null;
  models?: { id: string; isDefault?: boolean; isSelectable?: boolean }[];
}

/** The daemon's API as the notes writer uses it: a workspace per folder, and the providers given. */
function notesHolder(entries: ProviderEntry[], created: Created[], archived: string[]) {
  const paseo = {
    providers: {
      waitForReady: async ({ cwd }: { cwd: string }) => ({ cwd, entries }),
    },
    workspaces: {
      open: async (cwd: string) => ({
        id: "wks_notes",
        directory: cwd,
        agents: {
          create: async (options: unknown) => {
            created.push({ cwd, options });
            return { id: "writer-1" };
          },
        },
      }),
    },
    agents: {
      ref: (agentId: string) => ({
        refresh: async () => {
          const found = KNOWN.get(agentId);
          return found ? { agent: found, project: null } : null;
        },
        archive: async () => {
          archived.push(agentId);
          return { archivedAt: "2026-11-17T05:10:00.000Z" };
        },
      }),
    },
  };
  return { remember: () => undefined, require: () => paseo } as unknown as PaseoHolder;
}

const NO_HUB = {
  read: async () => {
    throw new Error("not read");
  },
};

test("the writer starts in the folder's workspace, on the first ready provider with the model and mode it offers first", async () => {
  const created: Created[] = [];
  const entries: ProviderEntry[] = [
    { provider: "codex", status: "error", enabled: true, models: [{ id: "gpt" }] },
    { provider: "opencode", status: "ready", enabled: false, models: [{ id: "big" }] },
    {
      provider: "claude",
      status: "ready",
      enabled: true,
      defaultModeId: "auto",
      models: [
        { id: "haiku", isSelectable: false, isDefault: true },
        { id: "opus" },
        { id: "sonnet", isDefault: true },
      ],
    },
  ];
  const ports = liveNotesPorts(notesHolder(entries, created, []), NO_HUB);
  expect(await ports.startAgent({ cwd: "/n", title: "Stand-up notes", prompt: "Write" })).toBe(
    "writer-1",
  );
  expect(created).toEqual([
    {
      cwd: "/n",
      options: {
        config: { provider: "claude/sonnet", modeId: "auto" },
        title: "Stand-up notes",
        prompt: "Write",
      },
    },
  ]);
});

test("a provider without a default model takes its first, and no mode when it names none", async () => {
  const created: Created[] = [];
  const entries = [
    { provider: "pi", status: "ready", enabled: true, defaultModeId: null, models: [{ id: "a" }] },
  ];
  await liveNotesPorts(notesHolder(entries, created, []), NO_HUB).startAgent({
    cwd: "/n",
    title: "Stand-up notes",
    prompt: "Write",
  });
  expect(created[0]?.options).toMatchObject({ config: { provider: "pi/a" } });
  expect(created[0]?.options).not.toHaveProperty("config.modeId");
});

test("a host with no ready provider starts no writer and says so", async () => {
  const created: Created[] = [];
  const entries = [{ provider: "claude", status: "loading", enabled: true, models: [] }];
  await expect(
    liveNotesPorts(notesHolder(entries, created, []), NO_HUB).startAgent({
      cwd: "/n",
      title: "Stand-up notes",
      prompt: "Write",
    }),
  ).rejects.toThrow("No agent provider is ready on this host");
  expect(created).toEqual([]);
});

test("a writer is at its turn only while it runs, and is archived through the daemon", async () => {
  const archived: string[] = [];
  const ports = liveNotesPorts(notesHolder([], [], archived), NO_HUB);
  expect(await ports.alive("run")).toBe(true);
  expect(await ports.alive("b-full-id")).toBe(false);
  expect(await ports.alive("old")).toBe(false);
  expect(await ports.alive("shut")).toBe(false);
  expect(await ports.alive("nobody")).toBe(false);
  await ports.archive("run");
  expect(archived).toEqual(["run"]);
});

test("only a directory is a folder", async () => {
  const home = await mkdtemp(join(tmpdir(), "office-notes-folder-"));
  try {
    await writeFile(join(home, "file.md"), "", "utf8");
    const ports = liveNotesPorts(notesHolder([], [], []), NO_HUB);
    expect(await ports.isDirectory(home)).toBe(true);
    expect(await ports.isDirectory(join(home, "file.md"))).toBe(false);
    expect(await ports.isDirectory(join(home, "missing"))).toBe(false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("an entry is in the notes when its header starts a line of its month's file directly in the folder", async () => {
  const home = await mkdtemp(join(tmpdir(), "office-notes-entry-"));
  try {
    await mkdir(join(home, "sub"));
    await writeFile(
      join(home, "daily-standup-202611.md"),
      "# Notes\n\n## Contents\n\n- [18 November 2026](#18-november-2026)\n\n---\n\n## 17 November 2026\n\nB\n",
      "utf8",
    );
    await writeFile(join(home, "sub", "daily-standup-202610.md"), "## 01 October 2026\n", "utf8");
    const ports = liveNotesPorts(notesHolder([], [], []), NO_HUB);
    const entry = (month: string, header: string) => ({ folder: home, month, header });
    expect(await ports.hasEntry(entry("202611", "17 November 2026"))).toBe(true);
    // Named only in the Contents list.
    expect(await ports.hasEntry(entry("202611", "18 November 2026"))).toBe(false);
    // A month with no file, and a file in a subfolder.
    expect(await ports.hasEntry(entry("202612", "01 December 2026"))).toBe(false);
    expect(await ports.hasEntry(entry("202610", "01 October 2026"))).toBe(false);
    await expect(
      ports.hasEntry({
        folder: join(home, "missing"),
        month: "202611",
        header: "17 November 2026",
      }),
    ).rejects.toThrow("ENOENT");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
