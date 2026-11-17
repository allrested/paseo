import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import {
  INCIDENT_SOURCES,
  IncidentSchema,
  type Incident,
  type IncidentSource,
} from "../shared/contracts.js";

const TrackerMarkSchema = z.object({
  checkedAt: z.number(),
  seen: z.record(z.string(), z.number()),
});

const IncidentsFileSchema = z.object({
  version: z.literal(1),
  trackers: z.partialRecord(z.enum(INCIDENT_SOURCES), TrackerMarkSchema),
  open: z.array(IncidentSchema),
});

export interface TrackerMark {
  /** Epoch ms of the tracker's last check. */
  checkedAt: number;
  /** Issue key → epoch ms the check first saw it. */
  seen: Record<string, number>;
}

export interface IncidentsData {
  version: 1;
  /** A tracker never checked has no mark. */
  trackers: Partial<Record<IncidentSource, TrackerMark>>;
  open: Incident[];
}

export const EMPTY_INCIDENTS: IncidentsData = emptyIncidents();

export interface IncidentsStore {
  /**
   * Runs after every earlier load and save. A missing file, or one that is not JSON or not of the
   * store's shape, is empty; any other read error rejects, so no save replaces a file it never read.
   */
  load(): Promise<IncidentsData>;
  /** Runs after every earlier load and save; rejects when the write fails. */
  save(data: IncidentsData): Promise<void>;
}

// A new object each time, since callers change what load returns.
function emptyIncidents(): IncidentsData {
  return { version: 1, trackers: {}, open: [] };
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

// Only the kind: a parse error's message quotes the file, and the titles come from the trackers.
function errorKind(error: unknown): string {
  if (!(error instanceof Error)) return typeof error;
  return "code" in error && typeof error.code === "string" ? error.code : error.name;
}

export function createIncidentsStore(options: {
  file: string;
  log(message: string): void;
}): IncidentsStore {
  const { file, log } = options;
  let chain: Promise<void> = Promise.resolve();
  let temp = 0;

  function unreadable(kind: string): IncidentsData {
    log(`[office] ${file} is unreadable (${kind}); starting empty, the next save replaces it`);
    return emptyIncidents();
  }

  async function read(): Promise<IncidentsData> {
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch (error) {
      if (isMissing(error)) return emptyIncidents();
      throw error;
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (error) {
      return unreadable(errorKind(error));
    }
    const parsed = IncidentsFileSchema.safeParse(json);
    if (!parsed.success) return unreadable("invalid");
    return parsed.data;
  }

  async function write(data: IncidentsData): Promise<void> {
    temp += 1;
    const tempFile = `${file}.tmp-${temp}`;
    await mkdir(dirname(file), { recursive: true });
    try {
      await writeFile(tempFile, `${JSON.stringify(data)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(tempFile, file);
    } catch (error) {
      await rm(tempFile, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  // Loads and saves share one queue, so a load always reads the saves called before it.
  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = chain.then(task);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  return {
    load: () => enqueue(read),
    save: (data) => enqueue(() => write(data)),
  };
}
