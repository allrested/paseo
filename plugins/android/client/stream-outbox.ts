// What the panel tells the host, gathered into one call at a time: each call crosses the link to
// the host, so a second one waits for the first. Inputs go out in the order they were made.
import type { AndroidInput } from "../shared/contracts.js";

export type OutboxInput = Pick<AndroidInput, "tap" | "swipe" | "key" | "text">;

/** More than this waiting means the host is not keeping up; the newest are dropped. */
export const MAX_QUEUED = 16;
export const STREAM_GONE = "The host no longer has this Android view";

export interface StreamOutboxDeps {
  send(message: AndroidInput): Promise<{ ok: boolean; message?: string }>;
  /** The stream cannot be reached any more; called once. */
  onLost(reason: string): void;
  /** The device refused an input; the stream is still open. */
  onRefused(message: string): void;
}

export interface StreamOutbox {
  /** The host named the stream: what was said before goes out now. */
  ready(streamId: string): void;
  /** The seq of the last picture on screen. */
  shown(seq: number): void;
  input(input: OutboxInput): void;
  /** Says the viewer is still there; nothing is sent while a call is on its way. */
  keepAlive(): void;
  stop(): void;
}

export function createStreamOutbox(deps: StreamOutboxDeps): StreamOutbox {
  let streamId: string | null = null;
  let stopped = false;
  let inFlight = false;
  let shown: number | undefined;
  const queue: OutboxInput[] = [];

  function lose(reason: string): void {
    if (stopped) return;
    stopped = true;
    deps.onLost(reason);
  }

  function flush(force = false): void {
    if (stopped || streamId === null || inFlight) return;
    if (shown === undefined && queue.length === 0 && !force) return;
    const message: AndroidInput = { streamId, ...queue.shift() };
    if (shown !== undefined) message.shown = shown;
    shown = undefined;
    inFlight = true;
    void (async () => {
      let answer: { ok: boolean; message?: string };
      try {
        answer = await deps.send(message);
      } catch (error) {
        inFlight = false;
        lose(error instanceof Error ? error.message : String(error));
        return;
      }
      inFlight = false;
      if (!answer.ok) {
        lose(STREAM_GONE);
        return;
      }
      if (answer.message !== undefined && !stopped) deps.onRefused(answer.message);
      flush();
    })();
  }

  return {
    ready(id) {
      streamId = id;
      flush();
    },
    shown(seq) {
      shown = seq;
      flush();
    },
    input(next) {
      if (queue.length >= MAX_QUEUED) return;
      queue.push(next);
      flush();
    },
    keepAlive: () => flush(true),
    stop() {
      stopped = true;
    },
  };
}
