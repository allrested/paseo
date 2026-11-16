import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import type { NotesState, OfficeSnapshot } from "../shared/contracts.js";
import { standupReport } from "../shared/standup-report.js";
import { errorMessage } from "./errors.js";
import { notesDay, notesFileName, notesPrompt } from "./notes-prompt.js";
import { notesFolder, notesTimeZone, type NotesSettings } from "./notes-schedule.js";

export const NOTES_WRITER_TITLE = "Stand-up notes";
const STOPPED = "The writer stopped on an error";
// Read after the card's "The writer stopped: ".
const CLOSED = "it was closed before it finished";
const NOT_WRITTEN = "it ended without writing today's entry";

/** The writer's part of the notes state; the office adds the schedule's error beside it. */
export type NotesWriterState = Omit<NotesState, "scheduleError">;

/** The entry a writer is told to write: its `## <header>` in the month's file in the folder. */
const WriterEntrySchema = z.object({
  folder: z.string(),
  month: z.string(),
  header: z.string(),
});
export type WriterEntry = z.output<typeof WriterEntrySchema>;

export const StoredNotesSchema = z.object({
  /** The writer at work; null while none is. */
  writerId: z.string().nullable(),
  writtenAt: z.number().nullable(),
  /**
   * The writer that stopped before it finished: on an error, stopped, closed (as the daemon
   * closes every agent when it shuts down), or ended without its entry. Still the office's: it
   * blocks a start while it is at its turn again, and a good end of it that leaves the entry in
   * the notes is recorded. At most one of the two ids is set.
   */
  failedAgentId: z.string().nullable(),
  problem: z.string().nullable(),
  /**
   * The kept writer's entry, set when it starts and gone with its id. A file saved before it was
   * kept has none: the folder set now and today's entry stand in.
   */
  entry: WriterEntrySchema.optional(),
});
export type StoredNotes = z.output<typeof StoredNotesSchema>;

export interface WriterStart {
  cwd: string;
  title: string;
  prompt: string;
}

export interface NotesPorts {
  settings(): Promise<NotesSettings>;
  /** The zone of the entry's day when the settings name none. */
  hostTimeZone: string;
  /** The office now, for the report. */
  snapshot(): Promise<OfficeSnapshot>;
  now(): number;
  /** Is a directory; false when missing or a file. */
  isDirectory(path: string): Promise<boolean>;
  /** Opens the folder's workspace and starts the agent with the host's default provider. Returns its id. */
  startAgent(input: WriterStart): Promise<string>;
  archive(agentId: string): Promise<void>;
  /** Whether the agent is still at its turn: it exists, is not archived, and runs. */
  alive(agentId: string): Promise<boolean>;
  /** Whether the entry's header starts a line of its month's file directly in its folder. */
  hasEntry(entry: WriterEntry): Promise<boolean>;
  load(): Promise<StoredNotes | null>;
  save(state: StoredNotes): Promise<void>;
  changed(state: NotesWriterState): void;
  log(message: string): void;
}

export interface NotesWriter {
  /**
   * Starts a writer unless one is at work, a start is on its way, or no folder is set. Never
   * rejects: why a writer could not start is kept as `problem`.
   */
  start(): Promise<{ started: boolean }>;
  /** From agent.turn.after. Rejects when the archive of a writer that wrote its entry fails. */
  turnEnded(agentId: string, failed: boolean, message: string | null): Promise<void>;
  /** From agent.close.after: a writer closed at its turn has stopped, and stays the office's. */
  agentClosed(agentId: string): Promise<void>;
  /** From agent.archive.after: the only end that forgets a writer. */
  agentArchived(agentId: string): Promise<void>;
  /** Reads the settings again, so `folderSet` follows them without a start. */
  settingsChanged(): Promise<void>;
  state(): NotesWriterState;
}

const NOTHING_KEPT: StoredNotes = {
  writerId: null,
  writtenAt: null,
  failedAgentId: null,
  problem: null,
};

interface TurnEnd {
  failed: boolean;
  message: string | null;
}

interface Launched {
  writerId: string;
  entry: WriterEntry;
}

function hasFolder(values: NotesSettings): boolean {
  return values.notesFolder.trim() !== "";
}

export function createNotesWriter(ports: NotesPorts): NotesWriter {
  let kept = NOTHING_KEPT;
  let folderSet = false;
  let starting = false;
  // Turns that end while a start waits for its agent's id: a first turn can fail before then.
  let endedWhileStarting: Map<string, TurnEnd> | null = null;

  function state(): NotesWriterState {
    return {
      folderSet,
      writing: kept.writerId !== null,
      writtenAt: kept.writtenAt,
      failedAgentId: kept.failedAgentId,
      problem: kept.problem,
    };
  }

  // A save that fails is logged: the state holds in memory, and a restart checks a kept writer.
  async function keep(next: StoredNotes): Promise<void> {
    kept = next;
    ports.changed(state());
    try {
      await ports.save(next);
    } catch (error) {
      ports.log(`[office] notes writer save failed: ${errorMessage(error)}`);
    }
  }

  async function load(): Promise<void> {
    try {
      kept = (await ports.load()) ?? NOTHING_KEPT;
      folderSet = hasFolder(await ports.settings());
      ports.changed(state());
    } catch (error) {
      ports.log(`[office] notes writer load failed: ${errorMessage(error)}`);
    }
  }
  const loaded = load();

  // The writer moves from at work to stopped, so at most one of the two ids is ever set.
  function stopped(agentId: string, problem: string): Promise<void> {
    return keep({ ...kept, writerId: null, failedAgentId: agentId, problem });
  }

  function isKept(agentId: string): boolean {
    return agentId === kept.writerId || agentId === kept.failedAgentId;
  }

  /** Today's entry in the folder set now, for a writer kept without its own; null with no folder. */
  async function todaysEntry(): Promise<WriterEntry | null> {
    const settings = await ports.settings();
    const folder = notesFolder(settings);
    if (folder === null) return null;
    return { folder, ...notesDay(ports.now(), notesTimeZone(settings, ports.hostTimeZone)) };
  }

  /** Whether the entry is in the notes now. Notes that cannot be read have not got it. */
  async function written(entry: WriterEntry | undefined): Promise<boolean> {
    try {
      const looked = entry ?? (await todaysEntry());
      return looked !== null && (await ports.hasEntry(looked));
    } catch (error) {
      ports.log(`[office] notes entry check failed: ${errorMessage(error)}`);
      return false;
    }
  }

  async function finish(agentId: string, end: TurnEnd): Promise<void> {
    if (end.failed) {
      await stopped(agentId, end.message || STOPPED);
      return;
    }
    const done = await written(kept.entry);
    // The read let other calls in: a writer archived or replaced meanwhile is not this end's.
    if (!isKept(agentId)) return;
    if (!done) {
      await stopped(agentId, NOT_WRITTEN);
      return;
    }
    await keep({ writerId: null, writtenAt: ports.now(), failedAgentId: null, problem: null });
    await ports.archive(agentId);
  }

  /** A writer of the office is at its turn: the one writing, or a stopped one resumed or prompted again. */
  async function atWork(): Promise<boolean> {
    if (kept.writerId !== null) {
      if (await ports.alive(kept.writerId)) return true;
      // Its end was missed: the daemon crashed under it, or the office was not loaded.
      await keep({ ...kept, writerId: null, entry: undefined });
    }
    return kept.failedAgentId !== null && (await ports.alive(kept.failedAgentId));
  }

  /** Starts a writer in the notes folder; null when no folder is set. */
  async function launch(settings: NotesSettings): Promise<Launched | null> {
    // Throws for a folder that is not an absolute path.
    const folder = notesFolder(settings);
    if (folder === null) return null;
    if (!(await ports.isDirectory(folder))) {
      throw new Error(`The notes folder ${folder} is not a folder`);
    }
    const now = ports.now();
    const day = notesDay(now, notesTimeZone(settings, ports.hostTimeZone));
    const prompt = notesPrompt({
      header: day.header,
      fileName: notesFileName(day.month),
      report: standupReport(await ports.snapshot(), now),
    });
    endedWhileStarting = new Map();
    const writerId = await ports.startAgent({ cwd: folder, title: NOTES_WRITER_TITLE, prompt });
    return { writerId, entry: { folder, ...day } };
  }

  async function startWriter(): Promise<{ started: boolean }> {
    if (await atWork()) return { started: false };
    const settings = await ports.settings();
    folderSet = hasFolder(settings);
    let launched: Launched | null;
    try {
      launched = await launch(settings);
    } catch (error) {
      // A new attempt: an older failure no longer stands, and this one's reason is kept.
      await keep({ ...kept, failedAgentId: null, problem: errorMessage(error), entry: undefined });
      return { started: false };
    }
    if (launched === null) {
      ports.changed(state());
      return { started: false };
    }
    const { writerId, entry } = launched;
    const early = endedWhileStarting?.get(writerId);
    await keep({ ...kept, writerId, failedAgentId: null, problem: null, entry });
    if (early !== undefined) {
      // The writer did start: a failed archive is not a failed start.
      await finish(writerId, early).catch((error: unknown) =>
        ports.log(`[office] notes writer archive failed: ${errorMessage(error)}`),
      );
    }
    return { started: true };
  }

  return {
    async start() {
      await loaded;
      if (starting) return { started: false };
      starting = true;
      try {
        return await startWriter();
      } catch (error) {
        // The check of a kept writer or the settings' read failed: the ids stay as they are.
        await keep({ ...kept, problem: errorMessage(error) });
        return { started: false };
      } finally {
        starting = false;
        endedWhileStarting = null;
      }
    },
    async turnEnded(agentId, failed, message) {
      await loaded;
      if (isKept(agentId)) {
        await finish(agentId, { failed, message });
      } else {
        endedWhileStarting?.set(agentId, { failed, message });
      }
    },
    async agentClosed(agentId) {
      await loaded;
      if (agentId === kept.writerId) await stopped(agentId, CLOSED);
    },
    async agentArchived(agentId) {
      await loaded;
      if (agentId === kept.writerId) {
        await keep({ ...kept, writerId: null, entry: undefined });
      } else if (agentId === kept.failedAgentId) {
        // The owner is done with a writer that stopped; its reason goes with it.
        await keep({ ...kept, failedAgentId: null, problem: null, entry: undefined });
      }
    },
    async settingsChanged() {
      await loaded;
      folderSet = hasFolder(await ports.settings());
      ports.changed(state());
    },
    state,
  };
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export interface NotesStore {
  /** Null for a missing file, and for one that cannot be read, which is logged. */
  load(): Promise<StoredNotes | null>;
  /** Runs after every earlier save and replaces the file in one rename; rejects when it fails. */
  save(state: StoredNotes): Promise<void>;
}

/** The writer's state in its own file, written as board-store.ts writes the boards. */
export function createNotesStore(options: {
  file: string;
  log(message: string): void;
}): NotesStore {
  const { file, log } = options;
  let temp = 0;
  // One save at a time, so a slow one never lands after a later one.
  let chain: Promise<void> = Promise.resolve();

  async function write(state: StoredNotes): Promise<void> {
    temp += 1;
    const tempFile = `${file}.tmp-${temp}`;
    await mkdir(dirname(file), { recursive: true });
    try {
      await writeFile(tempFile, `${JSON.stringify(state)}\n`, "utf8");
      await rename(tempFile, file);
    } catch (error) {
      await rm(tempFile, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  return {
    async load() {
      let text: string;
      try {
        text = await readFile(file, "utf8");
      } catch (error) {
        if (!isMissing(error)) log(`[office] ${file} is unreadable: ${errorMessage(error)}`);
        return null;
      }
      try {
        return StoredNotesSchema.parse(JSON.parse(text));
      } catch (error) {
        log(`[office] ${file} is unreadable (${errorMessage(error)}); the next save replaces it`);
        return null;
      }
    },
    save(state) {
      const run = chain.then(() => write(state));
      chain = run.catch(() => undefined);
      return run;
    },
  };
}
