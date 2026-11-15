import { useCallback, useEffect, useRef, useState } from "react";
import { useRpc, useSubscription } from "@getpaseo/plugin/client";
import { RANGES, statsChanges, statsRpc, type Stats } from "../shared/contracts.js";
import { sinceHour } from "./aggregate.js";

const NO_INPUT = {};
const LONGEST = Math.max(...RANGES);

export type LiveStats =
  | { status: "loading" }
  | { status: "error"; message: string }
  /** `readAt` is when the host was asked: the range's last day is that moment's. */
  | { status: "ready"; stats: Stats; readAt: number };

/**
 * The host's counts for the longest range, read when the screen opens and again after each turn
 * that ends while it is mounted. A shorter range is cut from the same answer, so changing the
 * range asks the host nothing.
 */
export function useStats(): LiveStats {
  const read = useRpc(statsRpc);
  const [state, setState] = useState<LiveStats>({ status: "loading" });
  // One read at a time, and one more for every change that came meanwhile.
  const reading = useRef(false);
  const behind = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const load = useCallback(async () => {
    if (reading.current) {
      behind.current = true;
      return;
    }
    reading.current = true;
    try {
      do {
        behind.current = false;
        const readAt = Date.now();
        let next: LiveStats;
        try {
          next = {
            status: "ready",
            stats: await read({ since: sinceHour(LONGEST, readAt) }),
            readAt,
          };
        } catch (error) {
          next = {
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          };
        }
        // Counts that were read stay on screen when a later read fails: they are still true.
        if (mounted.current) {
          setState((now) => (next.status === "error" && now.status === "ready" ? now : next));
        }
      } while (behind.current && mounted.current);
    } finally {
      reading.current = false;
    }
  }, [read]);
  useEffect(() => {
    void load();
  }, [load]);
  const onChange = useCallback(() => void load(), [load]);
  useSubscription(statsChanges, NO_INPUT, onChange);
  return state;
}
