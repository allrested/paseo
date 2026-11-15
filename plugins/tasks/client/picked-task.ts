import { useSyncExternalStore } from "react";

// The Task field and the composer's Task prompt control are two contributions on one screen, and
// the control cannot read the New workspace setup: the field tells it which task is picked.
let picked: string | null = null;
const listeners = new Set<() => void>();

/** The id of the task picked on the New workspace screen that is open; null when none is. */
export const pickedTask = {
  get: (): string | null => picked,
  set(id: string | null): void {
    if (id === picked) return;
    picked = id;
    for (const listener of listeners) listener();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
};

export function usePickedTask(): string | null {
  return useSyncExternalStore(pickedTask.subscribe, pickedTask.get, pickedTask.get);
}
