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
  type WriterEntry,
  type WriterStart,
} from "./notes-writer.js";

/** 08:00 on Tuesday 17 November 2026 in Riyadh. */
const NOW = Date.parse("2026-11-17T05:00:00.000Z");
/** The entry a writer started at NOW in /n is told to write. */
const TODAY: WriterEntry = { folder: "/n", month: "202611", header: "17 November 2026" };
const NOT_WRITTEN = "it ended without writing today's entry";

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
  /** The entries in the notes, by `entryKey`. */
  entries: Set<string>;
  /** Every entry looked for, in order. */
  checked: WriterEntry[];
  /** Runs inside a look for an entry before it answers, as a bell or a hook can. */
  duringCheck: (() => Promise<void>) | null;
}

const entryKey = ({ folder, month, header }: WriterEntry) => `${folder} ${month} ${header}`;

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
    entries: new Set(),
    checked: [],
    duringCheck: null,
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
    async hasEntry(entry) {
      ports.checked.push(entry);
      await ports.duringCheck?.();
      return ports.entries.has(entryKey(entry));
    },
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

/** The writer leaves its entry in the notes. */
function wrote(entry: WriterEntry = TODAY): void {
  ports.entries.add(entryKey(entry));
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
  wrote({ folder: "/n", month: "202612", header: "01 December 2026" });
  await w.turnEnded(ports.lastId, false, null);

  ports.values.notesTimeZone = " UTC ";
  await w.start();
  expect(ports.started[1].prompt).toContain("for 30 November 2026");
  expect(ports.started[1].prompt).toContain("daily-standup-202611.md");
});

test("a writer that ends well with its entry in the notes is recorded and archived", async () => {
  await w.start();
  // The writer is kept with the entry it is told to write.
  expect(ports.stored).toMatchObject({ writerId: ports.lastId, entry: TODAY });
  wrote();
  await w.turnEnded(ports.lastId, false, null);
  expect(ports.checked).toEqual([TODAY]);
  expect(w.state()).toMatchObject({ writing: false, writtenAt: NOW, problem: null });
  expect(ports.archived).toEqual([ports.lastId]);
  expect(ports.stored).toEqual({
    writerId: null,
    writtenAt: NOW,
    failedAgentId: null,
    problem: null,
  });
});

test("a writer that ends well without its entry in the notes is stopped with the reason, and left", async () => {
  await w.start();
  // Another day's entry is not today's.
  wrote({ ...TODAY, header: "16 November 2026" });
  await w.turnEnded(ports.lastId, false, null);
  expect(w.state()).toMatchObject({
    writing: false,
    writtenAt: null,
    failedAgentId: ports.lastId,
    problem: NOT_WRITTEN,
  });
  expect(ports.archived).toEqual([]);
  expect(ports.stored).toMatchObject({ failedAgentId: ports.lastId, entry: TODAY });
});

test("notes that cannot be read count as no entry, and why is logged", async () => {
  ports.hasEntry = async () => {
    throw new Error("EACCES: permission denied, scandir '/n'");
  };
  await w.start();
  await w.turnEnded(ports.lastId, false, null);
  expect(w.state()).toMatchObject({
    writtenAt: null,
    failedAgentId: ports.lastId,
    problem: NOT_WRITTEN,
  });
  expect(ports.archived).toEqual([]);
  expect(ports.logs).toEqual([
    "[office] notes entry check failed: EACCES: permission denied, scandir '/n'",
  ]);
});

test("the entry looked for is the one the writer was started for, after a restart and a change of settings", async () => {
  await w.start();
  const writerId = ports.lastId;
  ports.values = { notesFolder: "/m", notesTimeZone: "UTC" };
  ports.now = () => NOW + 24 * 60 * 60 * 1000;
  const again = createNotesWriter(ports);
  wrote();
  await again.turnEnded(writerId, false, null);
  expect(ports.checked).toEqual([TODAY]);
  expect(ports.archived).toEqual([writerId]);
});

test("a bell rung while the entry is looked for keeps its new writer", async () => {
  await w.start();
  const first = ports.lastId;
  wrote();
  // The first writer's turn has ended, so it no longer counts as at work.
  ports.duringCheck = async () => {
    ports.duringCheck = null;
    ports.aliveIds.delete(first);
    expect(await w.start()).toEqual({ started: true });
  };
  await w.turnEnded(first, false, null);
  expect(w.state()).toMatchObject({ writing: true, writtenAt: null });
  expect(ports.stored).toMatchObject({ writerId: ports.lastId, entry: TODAY });
  expect(ports.lastId).not.toBe(first);
  expect(ports.archived).toEqual([]);
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
  wrote();
  ports.duringStart = (agentId) => w.turnEnded(agentId, false, null);
  expect(await w.start()).toEqual({ started: true });
  expect(w.state()).toMatchObject({ writing: false, writtenAt: NOW });
  expect(ports.archived).toEqual([ports.lastId]);
});

test("a writer that ended before its start returned and cannot be archived still counts as started", async () => {
  wrote();
  ports.duringStart = (agentId) => w.turnEnded(agentId, false, null);
  ports.archive = async () => {
    throw new Error("archive refused");
  };
  expect(await w.start()).toEqual({ started: true });
  expect(w.state()).toMatchObject({ writing: false, writtenAt: NOW, problem: null });
  expect(ports.logs).toEqual(["[office] notes writer archive failed: archive refused"]);
});

test("after a restart a writer still running blocks a new one, and its end archives it", async () => {
  // Kept by an older office, without its entry: the folder set now and today's are looked for.
  ports.stored = { writerId: "w1", writtenAt: null, failedAgentId: null, problem: null };
  ports.aliveIds = new Set(["w1"]);
  const again = createNotesWriter(ports);
  expect((await again.start()).started).toBe(false);
  wrote();
  await again.turnEnded("w1", false, null);
  expect(ports.checked).toEqual([TODAY]);
  expect(ports.archived).toEqual(["w1"]);
});

test("a writer kept without its entry, and no folder set any more, has not written it", async () => {
  ports.stored = { writerId: "w1", writtenAt: null, failedAgentId: null, problem: null };
  ports.values.notesFolder = "";
  const again = createNotesWriter(ports);
  await again.turnEnded("w1", false, null);
  expect(ports.checked).toEqual([]);
  expect(again.state()).toMatchObject({ failedAgentId: "w1", problem: NOT_WRITTEN });
  expect(ports.archived).toEqual([]);
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

test("a graceful restart: the writer closed at shutdown and resumed after it blocks a new one, and its end with the entry is recorded", async () => {
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

  wrote();
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

test("a stopped turn leaves the writer named; prompted again it blocks a new one, and only a good end with the entry is recorded", async () => {
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

  // The owner asks what went wrong; the answer writes nothing.
  await again.turnEnded(writerId, false, null);
  expect(again.state()).toMatchObject({
    writtenAt: null,
    failedAgentId: writerId,
    problem: NOT_WRITTEN,
  });
  expect(ports.archived).toEqual([]);

  // The owner asks it to write the entry, and it does.
  wrote();
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
  wrote();
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
      entry: TODAY,
    };

    expect(await store.load()).toBeNull();
    await store.save(kept);
    expect(await store.load()).toEqual(kept);
    // Written in place by a rename: no temporary file is left beside it.
    expect(await readdir(dirname(file))).toEqual(["notes-writer.json"]);

    // A file from before the entry was kept still reads.
    const older = { writerId: "w1", writtenAt: NOW, failedAgentId: null, problem: null };
    await writeFile(file, JSON.stringify(older), "utf8");
    expect(await store.load()).toEqual(older);

    await writeFile(file, "{ not json", "utf8");
    expect(await store.load()).toBeNull();
    expect(logs).toHaveLength(1);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
