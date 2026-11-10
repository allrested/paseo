import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { writeJsonFileAtomic } from "../../atomic-file.js";

const CdpTabEntrySchema = z.object({
  browserId: z.string(),
  targetId: z.string(),
  workspaceId: z.string(),
  lastUrl: z.string(),
  createdAt: z.number(),
});
const CdpTabFileSchema = z.object({ version: z.literal(1), tabs: z.array(CdpTabEntrySchema) });

export type CdpTabEntry = z.infer<typeof CdpTabEntrySchema>;

/** The tabs this daemon opened. Any target not listed here belongs to someone else. */
export class CdpTabRegistry {
  private readonly tabs = new Map<string, CdpTabEntry>();
  private dirty = false;
  private writing: Promise<void> | null = null;

  constructor(
    private readonly filePath: string,
    private readonly onError: (error: unknown) => void = () => {},
  ) {}

  async load(): Promise<void> {
    this.tabs.clear();
    try {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const parsed = CdpTabFileSchema.parse(JSON.parse(await readFile(this.filePath, "utf8")));
      for (const tab of parsed.tabs) this.tabs.set(tab.browserId, tab);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.report(error);
    }
  }

  list(): CdpTabEntry[] {
    return [...this.tabs.values()];
  }

  get(browserId: string): CdpTabEntry | null {
    return this.tabs.get(browserId) ?? null;
  }

  findByTarget(targetId: string): CdpTabEntry | null {
    for (const tab of this.tabs.values()) if (tab.targetId === targetId) return tab;
    return null;
  }

  add(entry: CdpTabEntry): void {
    this.tabs.set(entry.browserId, entry);
    this.schedule();
  }

  remove(browserId: string): CdpTabEntry | null {
    const entry = this.tabs.get(browserId) ?? null;
    if (entry) {
      this.tabs.delete(browserId);
      this.schedule();
    }
    return entry;
  }

  setLastUrl(browserId: string, url: string): void {
    const entry = this.tabs.get(browserId);
    if (!entry || entry.lastUrl === url) return;
    this.tabs.set(browserId, { ...entry, lastUrl: url });
    this.schedule();
  }

  reconcile(liveTargetIds: ReadonlySet<string>): CdpTabEntry[] {
    const dropped = this.list().filter((tab) => !liveTargetIds.has(tab.targetId));
    for (const tab of dropped) this.tabs.delete(tab.browserId);
    if (dropped.length > 0) this.schedule();
    return dropped;
  }

  adoptPopup(input: {
    targetId: string;
    openerId: string;
    url: string;
    browserId: string;
    now: number;
  }): CdpTabEntry | null {
    const opener = this.findByTarget(input.openerId);
    if (!opener || this.findByTarget(input.targetId)) return null;
    const entry: CdpTabEntry = {
      browserId: input.browserId,
      targetId: input.targetId,
      workspaceId: opener.workspaceId,
      lastUrl: input.url,
      createdAt: input.now,
    };
    this.add(entry);
    return entry;
  }

  flush(): Promise<void> {
    return this.writing ?? Promise.resolve();
  }

  /** The error sink is caller code; a throwing sink must not become an unhandled rejection. */
  private report(error: unknown): void {
    try {
      this.onError(error);
    } catch {
      // Nothing left to tell: the sink itself failed.
    }
  }

  /** One writer at a time; changes made during a write are picked up by the next loop turn. */
  private schedule(): void {
    this.dirty = true;
    if (this.writing) return;
    this.writing = this.drain().finally(() => {
      this.writing = null;
    });
  }

  private async drain(): Promise<void> {
    while (this.dirty) {
      this.dirty = false;
      try {
        await writeJsonFileAtomic(this.filePath, { version: 1, tabs: this.list() });
      } catch (error) {
        this.report(error);
      }
    }
  }
}
