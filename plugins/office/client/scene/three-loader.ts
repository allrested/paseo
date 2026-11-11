import { isThreeModule, type ThreeModule } from "./three-types.js";

export type ThreeLoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; three: ThreeModule }
  | { status: "failed"; error: string };

export interface ThreeLoaderPorts {
  fetchBytes(): Promise<Uint8Array<ArrayBuffer>>;
  evaluate(bytes: Uint8Array<ArrayBuffer>): Promise<unknown>;
}

export interface ThreeLoader {
  state(): ThreeLoadState;
  subscribe(listener: () => void): () => void;
  /** Loads once; a later call after a failure tries again. Never rejects. */
  load(ports: ThreeLoaderPorts): Promise<void>;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createThreeLoader(): ThreeLoader {
  let current: ThreeLoadState = { status: "idle" };
  let pending: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  function set(next: ThreeLoadState): void {
    current = next;
    for (const listener of listeners) listener();
  }
  async function run(ports: ThreeLoaderPorts): Promise<void> {
    set({ status: "loading" });
    try {
      const module = await ports.evaluate(await ports.fetchBytes());
      set(
        isThreeModule(module)
          ? { status: "ready", three: module }
          : { status: "failed", error: "Unexpected three.js build" },
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
    load(ports) {
      if (current.status === "ready") return Promise.resolve();
      pending ??= run(ports).finally(() => {
        pending = null;
      });
      return pending;
    },
  };
}

/** One per page: three.js stays in memory for the page's life once a device has loaded it. */
export const sharedThreeLoader: ThreeLoader = createThreeLoader();
