import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import type { OfficeSnapshot } from "../shared/contracts.js";
import { standupReport } from "../shared/standup-report.js";
import { settle } from "./fake-clock.js";
import type { NotesSettings } from "./notes-schedule.js";
import {
  createNotesStore,
  createNotesWriter,
  type NotesPorts,
  type NotesWriter,
  type NotesWriterState,
  type StoredNotes,
  type WriterStart,
} from "./notes-writer.js";

/** 08:00 on Tuesday 17 November 2026 in Riyadh. */
const NOW = Date.parse("2026-11-17T05:00:00.000Z");

const SNAPSHOT: OfficeSnapshot = {
  agents: [
    {
      id: "a1",
      title: "Builder",
      provider: "claude",
      model: null,
      status: "idle",
      workspaceId: "w1",
      parentAgentId: null,
      permissions: [],
      createdAt: "2026-11-17T04:00:00.000Z",
    },
  ],
  workspaces: [{ id: "w1", name: "shop-api", projectName: "shop", branch: "main" }],
  activity: {},
  boards: {},
  wake: { paused: false, queued: {} },
};

interface FakePorts extends NotesPorts {
  values: NotesSettings;
  directories: Set<string>;
  started: WriterStart[];
  archived: string[];
  aliveIds: Set<string>;
  stored: StoredNotes | null;
  changes: NotesWriterState[];
  logs: string[];
  lastId: string;
  failStart: Error | null;
  /** Runs inside a start before the id comes back, as a hook can. */
  duringStart: ((agentId: string) => Promise<void>) | null;
}

function fakePorts(): FakePorts {
  const ports: FakePorts = {
    values: { notesFolder: "/n", notesTimeZone: "" },
    directories: new Set(["/n"]),
    started: [],
    archived: [],
    aliveIds: new Set(),
    stored: null,
    changes: [],
    logs: [],
    lastId: "",
    failStart: null,
    duringStart: null,
    hostTimeZone: "Asia/Riyadh",
    settings: async () => ({ ...ports.values }),
    snapshot: async () => SNAPSHOT,
    now: () => NOW,
    isDirectory: async (path) => ports.directories.has(path),
    async startAgent(input) {
      if (ports.failStart) throw ports.failStart;
      ports.started.push(input);
      ports.lastId = `writer-${ports.started.length}`;
      ports.aliveIds.add(ports.lastId);
      await ports.duringStart?.(ports.lastId);
      return ports.lastId;
    },
    async archive(agentId) {
      ports.archived.push(agentId);
      ports.aliveIds.delete(agentId);
    },
    alive: async (agentId) => ports.aliveIds.has(agentId),
    load: async () => ports.stored,
    save: async (state) => {
      ports.stored = state;
    },
    changed: (state) => void ports.changes.push(state),
    log: (message) => void ports.logs.push(message),
  };
  return ports;
}

let ports: FakePorts;
let w: NotesWriter;

beforeEach(() => {
  ports = fakePorts();
  w = createNotesWriter(ports);
});

function writer(values: Partial<NotesSettings>): NotesWriter {
  Object.assign(ports.values, values);
  return createNotesWriter(ports);
}

test("no folder: nothing starts", async () => {
  expect(await writer({ notesFolder: "" }).start()).toEqual({ started: false });
  expect(ports.started).toEqual([]);
});

test("a folder that is not a folder: the reason is kept", async () => {
  ports.directories = new Set();
  await w.start();
  expect(w.state()).toMatchObject({
    writing: false,
    problem: "The notes folder /n is not a folder",
  });
});

test("a folder that is not an absolute path is refused, as the schedule refuses it", async () => {
  const relative = writer({ notesFolder: " notes " });
  expect(await relative.start()).toEqual({ started: false });
  expect(relative.state()).toMatchObject({
    folderSet: true,
    writing: false,
    problem: "The notes folder must be an absolute path: notes",
  });
  expect(ports.started).toEqual([]);
});

test("one writer: a second start while it writes, or at the same time, does nothing", async () => {
  const [a, b] = await Promise.all([w.start(), w.start()]);
  expect([a.started, b.started].sort()).toEqual([false, true]);
  expect((await w.start()).started).toBe(false);
  expect(ports.started).toHaveLength(1);
  expect(ports.started[0]).toMatchObject({ cwd: "/n", title: "Stand-up notes" });
  expect(ports.started[0].prompt).toContain("daily-standup-202611.md");
});

test("the writer is told the day in the notes time zone, else the host's, and gets the office's report", async () => {
  // 01:30 on 1 December in Riyadh, still 30 November in UTC.
  ports.now = () => Date.parse("2026-11-30T22:30:00.000Z");
  await w.start();
  expect(ports.started[0].prompt).toContain("for 01 December 2026");
  expect(ports.started[0].prompt).toContain("daily-standup-202612.md");
  expect(ports.started[0].prompt).toContain(
    standupReport(SNAPSHOT, Date.parse("2026-11-30T22:30:00.000Z")),
  );
  await w.turnEnded(ports.lastId, false, null);

  ports.values.notesTimeZone = " UTC ";
  await w.start();
  expect(ports.started[1].prompt).toContain("for 30 November 2026");
  expect(ports.started[1].prompt).toContain("daily-standup-202611.md");
});

test("a writer that ends well is recorded and archived", async () => {
  await w.start();
  await w.turnEnded(ports.lastId, false, null);
  expect(w.state()).toMatchObject({ writing: false, writtenAt: NOW, problem: null });
  expect(ports.archived).toEqual([ports.lastId]);
  expect(ports.stored).toEqual({
    writerId: null,
    writtenAt: NOW,
    failedAgentId: null,
    problem: null,
  });
});

test("a writer that stops on an error is left, and named", async () => {
  await w.start();
  await w.turnEnded(ports.lastId, true, "Rate limited");
  expect(w.state()).toMatchObject({
    writing: false,
    failedAgentId: ports.lastId,
    problem: "Rate limited",
  });
  expect(ports.archived).toEqual([]);
});

test("a failed turn without a message is said to have stopped on an error", async () => {
  await w.start();
  await w.turnEnded(ports.lastId, true, null);
  expect(w.state().problem).toBe("The writer stopped on an error");
});

test("a new start clears an older failure, and a good end clears it too", async () => {
  await w.start();
  await w.turnEnded(ports.lastId, true, "Rate limited");
  // A failed turn leaves the agent idle: no longer at its turn.
  ports.aliveIds.delete(ports.lastId);
  await w.start();
  expect(w.state()).toMatchObject({ writing: true, failedAgentId: null, problem: null });

  ports.directories = new Set();
  await w.turnEnded(ports.lastId, true, "Rate limited");
  ports.aliveIds.delete(ports.lastId);
  await w.start();
  expect(w.state()).toMatchObject({
    failedAgentId: null,
    problem: "The notes folder /n is not a folder",
  });
});

test("a writer that cannot start leaves nothing running and says why", async () => {
  ports.failStart = new Error("No agent provider is ready on this host");
  expect(await w.start()).toEqual({ started: false });
  expect(w.state()).toMatchObject({
    writing: false,
    problem: "No agent provider is ready on this host",
  });
  expect(ports.stored?.writerId).toBeNull();
});

test("a writer whose turn ends before its start returns is still recorded and archived", async () => {
  ports.duringStart = (agentId) => w.turnEnded(agentId, false, null);
  expect(await w.start()).toEqual({ started: true });
  expect(w.state()).toMatchObject({ writing: false, writtenAt: NOW });
  expect(ports.archived).toEqual([ports.lastId]);
});

test("a writer that ended before its start returned and cannot be archived still counts as started", async () => {
  ports.duringStart = (agentId) => w.turnEnded(agentId, false, null);
  ports.archive = async () => {
    throw new Error("archive refused");
  };
  expect(await w.start()).toEqual({ started: true });
  expect(w.state()).toMatchObject({ writing: false, writtenAt: NOW, problem: null });
  expect(ports.logs).toEqual(["[office] notes writer archive failed: archive refused"]);
});

test("after a restart a writer still running blocks a new one, and its end archives it", async () => {
  ports.stored = { writerId: "w1", writtenAt: null, failedAgentId: null, problem: null };
  ports.aliveIds = new Set(["w1"]);
  const again = createNotesWriter(ports);
  expect((await again.start()).started).toBe(false);
  await again.turnEnded("w1", false, null);
  expect(ports.archived).toEqual(["w1"]);
});

test("a stored writer that is gone is cleared on load", async () => {
  ports.stored = { writerId: "w1", writtenAt: null, failedAgentId: null, problem: null };
  ports.aliveIds = new Set();
  expect((await createNotesWriter(ports).start()).started).toBe(true);
});

test("a turn of another agent changes nothing", async () => {
  await w.start();
  await w.turnEnded("someone-else", false, null);
  expect(w.state().writing).toBe(true);
});

test("a writer archived by someone else is forgotten, and frees the bell", async () => {
  await w.start();
  await w.agentArchived("someone-else");
  await w.agentClosed("someone-else");
  expect(w.state().writing).toBe(true);
  await w.agentArchived(ports.lastId);
  expect(w.state()).toMatchObject({ writing: false, writtenAt: null, failedAgentId: null });
  expect((await w.start()).started).toBe(true);
});

const CLOSED = "it was closed before it finished";

test("a graceful restart: the writer closed at shutdown and resumed after it blocks a new one, and its end is recorded", async () => {
  await w.start();
  const writerId = ports.lastId;
  // The daemon closes every agent as it shuts down; the office still names the writer.
  await w.agentClosed(writerId);
  expect(w.state()).toMatchObject({ writing: false, failedAgentId: writerId, problem: CLOSED });
  expect(ports.stored).toMatchObject({ writerId: null, failedAgentId: writerId, problem: CLOSED });

  // The daemon starts again and resumes the writer's turn.
  const kept = ports.stored;
  const again = createNotesWriter(ports);
  expect(await again.start()).toEqual({ started: false });
  expect(ports.stored).toEqual(kept);
  expect(ports.started).toHaveLength(1);

  await again.turnEnded(writerId, false, null);
  expect(again.state()).toMatchObject({
    writing: false,
    writtenAt: NOW,
    failedAgentId: null,
    problem: null,
  });
  expect(ports.archived).toEqual([writerId]);
});

test("a graceful restart without resume: the closed writer is named until a new start replaces it", async () => {
  await w.start();
  const writerId = ports.lastId;
  await w.agentClosed(writerId);
  ports.aliveIds.delete(writerId);

  const again = createNotesWriter(ports);
  await settle();
  expect(again.state()).toMatchObject({ failedAgentId: writerId, problem: CLOSED });
  expect(await again.start()).toEqual({ started: true });
  expect(again.state()).toMatchObject({ writing: true, failedAgentId: null, problem: null });
  expect(ports.archived).toEqual([]);
});

test("a stopped turn leaves the writer named; prompted again it blocks a new one, and its good end is recorded", async () => {
  await w.start();
  const writerId = ports.lastId;
  await w.turnEnded(writerId, true, "interrupted");
  expect(w.state()).toMatchObject({
    writing: false,
    failedAgentId: writerId,
    problem: "interrupted",
  });

  // At its turn again (resumed by the daemon, or prompted by the owner), across a restart.
  const kept = ports.stored;
  const again = createNotesWriter(ports);
  expect(await again.start()).toEqual({ started: false });
  expect(ports.stored).toEqual(kept);

  await again.turnEnded(writerId, false, null);
  expect(again.state()).toMatchObject({ writtenAt: NOW, failedAgentId: null, problem: null });
  expect(ports.archived).toEqual([writerId]);
});

test("a writer that stopped and is archived is forgotten with its reason", async () => {
  await w.start();
  await w.turnEnded(ports.lastId, true, "Rate limited");
  await w.agentArchived(ports.lastId);
  expect(w.state()).toMatchObject({ writing: false, failedAgentId: null, problem: null });
});

test("before any start the state is what was kept, and whether a folder is set", async () => {
  ports.stored = { writerId: null, writtenAt: 1, failedAgentId: "f", problem: "Rate limited" };
  const fresh = createNotesWriter(ports);
  await settle();
  const expected = {
    folderSet: true,
    writing: false,
    writtenAt: 1,
    failedAgentId: "f",
    problem: "Rate limited",
  };
  expect(fresh.state()).toEqual(expected);
  expect(ports.changes.at(-1)).toEqual(expected);
});

test("a folder cleared in the settings shows without a start", async () => {
  await settle();
  expect(w.state().folderSet).toBe(true);
  ports.values.notesFolder = "  ";
  await w.settingsChanged();
  expect(w.state().folderSet).toBe(false);
  expect(ports.changes.at(-1)?.folderSet).toBe(false);
});

test("every change is pushed", async () => {
  await w.start();
  expect(ports.changes.at(-1)).toMatchObject({ writing: true });
  await w.turnEnded(ports.lastId, false, null);
  expect(ports.changes.at(-1)).toMatchObject({ writing: false, writtenAt: NOW });
});

test("the store keeps the state in its file, and reads a missing or broken file as nothing kept", async () => {
  const home = await mkdtemp(join(tmpdir(), "office-notes-"));
  try {
    const file = join(home, "office", "notes-writer.json");
    const logs: string[] = [];
    const store = createNotesStore({ file, log: (message) => logs.push(message) });
    const kept: StoredNotes = {
      writerId: "w1",
      writtenAt: NOW,
      failedAgentId: null,
      problem: null,
    };

    expect(await store.load()).toBeNull();
    await store.save(kept);
    expect(await store.load()).toEqual(kept);
    // Written in place by a rename: no temporary file is left beside it.
    expect(await readdir(dirname(file))).toEqual(["notes-writer.json"]);

    await writeFile(file, "{ not json", "utf8");
    expect(await store.load()).toBeNull();
    expect(logs).toHaveLength(1);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
