import { useCallback, useEffect, useState } from "react";
import { useRpc, useSubscription } from "@getpaseo/plugin/client";
import {
  attributionChanges,
  fileRpc,
  filesRpc,
  type FileLines,
  type Files,
} from "../shared/contracts.js";

const NO_INPUT = {};

export type Live<Value> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; value: Value };

const LOADING = { status: "loading" } as const;

interface Held<Value> {
  /** The read the state answers: another read's answer is not shown. */
  read: unknown;
  state: Live<Value>;
}

/**
 * Reads when mounted, when `read` changes and at each `reload()`. The latest read wins, and an
 * answer that was read stays on screen when a later read of the same thing fails.
 */
function useLive<Value>(read: (() => Promise<Value>) | null): [Live<Value>, () => void] {
  const [held, setHeld] = useState<Held<Value>>({ read, state: LOADING });
  const [reloads, setReloads] = useState(0);
  useEffect(() => {
    if (read === null) return undefined;
    let current = true;
    void (async () => {
      let next: Live<Value>;
      try {
        next = { status: "ready", value: await read() };
      } catch (error) {
        next = { status: "error", message: error instanceof Error ? error.message : String(error) };
      }
      if (!current) return;
      setHeld((now) =>
        next.status === "error" && now.read === read && now.state.status === "ready"
          ? now
          : { read, state: next },
      );
    })();
    return () => {
      current = false;
    };
  }, [read, reloads]);
  const reload = useCallback(() => setReloads((count) => count + 1), []);
  return [held.read === read ? held.state : LOADING, reload];
}

/** The files agents changed in the workspace's checkout, read again after each recorded change. */
export function useFiles(workspaceId: string): [Live<Files>, () => void] {
  const call = useRpc(filesRpc);
  const read = useCallback(() => call({ workspaceId }), [call, workspaceId]);
  const [state, reload] = useLive(read);
  useSubscription(attributionChanges, NO_INPUT, reload);
  return [state, reload];
}

/** One file's lines, read again after each recorded change. A null `path` reads nothing. */
export function useFile(workspaceId: string, path: string | null): [Live<FileLines>, () => void] {
  const call = useRpc(fileRpc);
  const read = useCallback(
    () => call({ workspaceId, path: path ?? "" }),
    [call, workspaceId, path],
  );
  const [state, reload] = useLive(path === null ? null : read);
  useSubscription(attributionChanges, NO_INPUT, reload);
  return [state, reload];
}
