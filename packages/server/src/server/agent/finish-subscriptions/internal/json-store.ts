import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { writeJsonFileAtomic } from "../../../atomic-file.js";
import type {
  FinishSubscription,
  FinishSubscriptionStore,
  FinishWatcher,
  FinishWatcherStore,
} from "../index.js";

const recordsSchema = z.array(
  z.object({
    id: z.string().min(1),
    callerAgentId: z.string().min(1),
    childAgentId: z.string().min(1),
    serverId: z.string().min(1).optional(),
    requireParentOwnership: z.boolean().optional(),
  }),
);

export function createJsonFinishSubscriptionStore(paseoHome: string): FinishSubscriptionStore {
  const file = join(paseoHome, "finish-subscriptions.json");
  let records: FinishSubscription[] | undefined;
  let pending = Promise.resolve();
  async function load(): Promise<FinishSubscription[]> {
    if (records) return records;
    try {
      records = recordsSchema.parse(JSON.parse(await readFile(file, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      records = [];
    }
    return records;
  }
  function serialized<T>(action: () => Promise<T>): Promise<T> {
    const result = pending.then(action);
    pending = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  async function mutate(
    update: (current: FinishSubscription[]) => FinishSubscription[],
  ): Promise<void> {
    const next = update(await load());
    await writeJsonFileAtomic(file, next);
    records = next;
  }
  return {
    list: () => serialized(async () => (await load()).map((record) => Object.assign({}, record))),
    put: (subscription) =>
      serialized(() =>
        mutate((current) => [
          ...current.filter((record) => record.id !== subscription.id),
          { ...subscription },
        ]),
      ),
    remove: (id) =>
      serialized(() => mutate((current) => current.filter((record) => record.id !== id))),
  };
}

const watchersSchema = z.array(
  z.object({
    childAgentId: z.string().min(1),
    callerAgentId: z.string().min(1),
    at: z.string().min(1),
  }),
);

/** Who was told about each agent's last turn, kept across restarts for session move. */
export function createJsonFinishWatcherStore(paseoHome: string): FinishWatcherStore {
  const file = join(paseoHome, "finish-watchers.json");
  let pending = Promise.resolve();
  return {
    async list(): Promise<FinishWatcher[]> {
      try {
        return watchersSchema.parse(JSON.parse(await readFile(file, "utf8")));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        return [];
      }
    },
    replace(watchers) {
      const written = pending.then(() => writeJsonFileAtomic(file, watchers));
      pending = written.then(
        () => undefined,
        () => undefined,
      );
      return written;
    },
  };
}
