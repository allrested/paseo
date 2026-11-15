/** The script of the page that draws the 3D office, as the host built it. */
export type WorldLoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; script: string }
  | { status: "failed"; error: string };

export interface WorldLoader {
  state(): WorldLoadState;
  subscribe(listener: () => void): () => void;
  /** Loads once; a later call after a failure tries again. Never rejects. */
  load(fetchScript: () => Promise<string>): Promise<void>;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createWorldLoader(): WorldLoader {
  let current: WorldLoadState = { status: "idle" };
  let pending: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  function set(next: WorldLoadState): void {
    current = next;
    for (const listener of listeners) listener();
  }
  async function run(fetchScript: () => Promise<string>): Promise<void> {
    set({ status: "loading" });
    try {
      const script = await fetchScript();
      set(
        script.trim() === ""
          ? { status: "failed", error: "The host sent an empty office build" }
          : { status: "ready", script },
      );
    } catch (error) {
      set({ status: "failed", error: messageOf(error) });
    }
  }
  return {
    state: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load(fetchScript) {
      if (current.status === "ready") return Promise.resolve();
      pending ??= run(fetchScript).finally(() => {
        pending = null;
      });
      return pending;
    },
  };
}

/** One per page: the script stays in memory for the page's life once a device has loaded it. */
export const sharedWorldLoader: WorldLoader = createWorldLoader();
