import { useSyncExternalStore } from "react";

/** A task picked on its page for the next workspace, until the New workspace screen takes it. */
export interface NextTask {
  id: string;
  key: string;
  url: string;
  branch: string;
}

let next: NextTask | null = null;
const listeners = new Set<() => void>();

// The tasks screen and the New workspace field are two contributions of one bundle, so a module
// value reaches from one to the other. It is not saved: a reload forgets the pick.
export const nextTask = {
  get: (): NextTask | null => next,
  set(task: NextTask | null): void {
    next = task;
    for (const listener of listeners) listener();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
};

export function useNextTask(): NextTask | null {
  return useSyncExternalStore(nextTask.subscribe, nextTask.get, nextTask.get);
}
