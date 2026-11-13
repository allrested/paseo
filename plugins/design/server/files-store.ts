import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

const DesignFileSchema = z.object({
  id: z.string().min(1),
  projectKey: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.number(),
  lastAgentId: z.string().nullable(),
  secrets: z.object({
    editLink: z.string(),
    viewLink: z.string(),
    ownerToken: z.string().nullable(),
  }),
});
export type DesignFile = z.output<typeof DesignFileSchema>;
export type PublicDesignFile = Omit<DesignFile, "secrets">;

const StoreSchema = z.object({ version: z.literal(1), files: z.array(DesignFileSchema) });

export interface FilesStore {
  list(projectKey: string): Promise<DesignFile[]>;
  get(id: string): Promise<DesignFile | null>;
  add(file: DesignFile): Promise<void>;
  update(id: string, patch: Partial<Pick<DesignFile, "name" | "lastAgentId">>): Promise<DesignFile>;
  remove(id: string): Promise<void>;
}

export function publicFile({ secrets: _secrets, ...rest }: DesignFile): PublicDesignFile {
  return rest;
}

/** One writer: every read and write runs in order on one queue; saves are atomic (temp + rename). */
export function createFilesStore(options: { file: string; log(line: string): void }): FilesStore {
  let files: DesignFile[] | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  function run<T>(work: () => Promise<T>): Promise<T> {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  }

  async function load(): Promise<DesignFile[]> {
    if (files !== null) return files;
    try {
      files = StoreSchema.parse(JSON.parse(await readFile(options.file, "utf8"))).files;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        options.log(
          `[design] files.json could not be read; starting empty (${(error as Error).name})`,
        );
      }
      files = [];
    }
    return files;
  }

  async function save(next: DesignFile[]): Promise<void> {
    await mkdir(dirname(options.file), { recursive: true, mode: 0o700 });
    const temp = `${options.file}.tmp`;
    await writeFile(temp, `${JSON.stringify({ version: 1, files: next }, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temp, options.file);
    files = next;
  }

  return {
    list: (projectKey) =>
      run(async () => (await load()).filter((f) => f.projectKey === projectKey)),
    get: (id) => run(async () => (await load()).find((f) => f.id === id) ?? null),
    add: (file) => run(async () => save([...(await load()), file])),
    update: (id, patch) =>
      run(async () => {
        const all = await load();
        const current = all.find((f) => f.id === id);
        if (!current) throw new Error(`No design file ${id}`);
        const updated = { ...current, ...patch };
        await save(all.map((f) => (f.id === id ? updated : f)));
        return updated;
      }),
    remove: (id) => run(async () => save((await load()).filter((f) => f.id !== id))),
  };
}
