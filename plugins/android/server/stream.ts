// One picture stream per viewer: the device's screen as PNGs, a picture only when it changed, and
// the viewer's touches and keys sent back to the device. Runs in the daemon process: nothing here
// may throw out of a timer or a handler.
import { createHash } from "node:crypto";
import type { AndroidInput, AndroidKey, AndroidStreamEvent } from "../shared/contracts.js";
import type { AndroidDevice } from "./device.js";
import { DeviceUnreachableError, UNREACHABLE, errorMessage } from "./errors.js";
import type { Clock } from "./timers.js";

export const PICTURE_INTERVAL_MS = 500;
export const MAX_VIEWERS = 2;
/** A viewer that says nothing for this long is gone: a locked phone, a dropped link. */
export const SILENCE_LIMIT_MS = 30_000;
/** Pictures sent that the viewer has not confirmed; a newer one replaces the one waiting. */
export const MAX_UNCONFIRMED = 2;

const NO_DEVICE = "No Android device on this host";
const FULL = "Two Android views are already open on this host";
const stopped = (reason: string) => `The Android view stopped: ${reason}`;

const KEYCODES: Record<AndroidKey, string> = {
  back: "KEYCODE_BACK",
  home: "KEYCODE_HOME",
  recents: "KEYCODE_APP_SWITCH",
  enter: "KEYCODE_ENTER",
  delete: "KEYCODE_DEL",
};

export interface AndroidSubscriber {
  push(event: AndroidStreamEvent): Promise<void>;
  signal: AbortSignal;
}

export interface AndroidStreams {
  /** Runs one viewer's stream; resolves when it ends. Never rejects. */
  attach(subscriber: AndroidSubscriber): Promise<void>;
  /** `message` says why the device refused an input that left the stream open. */
  input(message: AndroidInput): Promise<{ ok: boolean; message?: string }>;
  stop(): Promise<void>;
}

export interface AndroidStreamsDeps {
  /** Null when the feature is off. */
  device: AndroidDevice | null;
  clock: Clock;
  newStreamId(): string;
  log(message: string): void;
}

interface Session {
  /** When the viewer was last heard from. */
  heardAt: number;
  sent: number;
  shown: number;
  /** Hash of the last picture sent, and the picture waiting for a confirmation. */
  sentHash: string | null;
  waiting: { hash: string; png: Buffer } | null;
  taking: boolean;
  /** Resolves once the session ended. */
  done: Promise<void>;
  end(problem: string | null): void;
  flush(): void;
}

const problemText = (error: unknown) =>
  error instanceof DeviceUnreachableError ? UNREACHABLE : stopped(errorMessage(error));

export function createAndroidStreams(deps: AndroidStreamsDeps): AndroidStreams {
  const { device } = deps;
  const sessions = new Map<string, Session>();
  /** Viewers still asking the device for its size hold a slot too. */
  let opening = 0;
  let closing = false;

  async function run(subscriber: AndroidSubscriber): Promise<void> {
    const push = async (event: AndroidStreamEvent): Promise<void> => {
      if (subscriber.signal.aborted) return;
      try {
        await subscriber.push(event);
      } catch (error) {
        deps.log(`[android] stream push failed: ${errorMessage(error)}`);
      }
    };
    const refuse = (message: string) => push({ type: "problem", message });

    if (device === null) return refuse(NO_DEVICE);
    if (closing) return;
    if (sessions.size + opening >= MAX_VIEWERS) return refuse(FULL);

    let size: { width: number; height: number };
    opening += 1;
    try {
      size = await device.size();
    } catch (error) {
      deps.log(`[android] stream failed to open: ${errorMessage(error)}`);
      return refuse(problemText(error));
    } finally {
      opening -= 1;
    }
    if (subscriber.signal.aborted || closing) return;

    const streamId = deps.newStreamId();
    let cancelTick: (() => void) | null = null;
    let ended = false;
    let finish!: () => void;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });

    const session: Session = {
      heardAt: deps.clock.now(),
      sent: 0,
      shown: 0,
      sentHash: null,
      waiting: null,
      taking: false,
      done,
      end(problem) {
        if (ended) return;
        ended = true;
        cancelTick?.();
        sessions.delete(streamId);
        if (problem !== null) deps.log(`[android] stream ${streamId} ended: ${problem}`);
        const tell = problem === null ? Promise.resolve() : refuse(problem);
        void tell.catch(() => undefined).then(finish);
      },
      flush() {
        if (ended || session.waiting === null) return;
        if (session.sent - session.shown >= MAX_UNCONFIRMED) return;
        const { hash, png } = session.waiting;
        session.waiting = null;
        session.sentHash = hash;
        session.sent += 1;
        void push({ type: "picture", seq: session.sent, png: png.toString("base64") });
      },
    };
    sessions.set(streamId, session);
    subscriber.signal.addEventListener("abort", () => session.end(null), { once: true });

    function taken(png: Buffer): void {
      if (ended) return;
      const hash = createHash("sha256").update(png).digest("hex");
      // What the viewer will have once it has caught up: a screen that went away and came back
      // while a picture waited sends nothing.
      session.waiting = hash === session.sentHash ? null : { hash, png };
      session.flush();
    }

    function tick(): void {
      cancelTick = null;
      if (ended) return;
      if (deps.clock.now() - session.heardAt > SILENCE_LIMIT_MS) {
        // Nobody is there to tell.
        deps.log(`[android] stream ${streamId} closed: its viewer went silent`);
        session.end(null);
        return;
      }
      if (!session.taking) {
        session.taking = true;
        device!
          .screenshot()
          .then(taken)
          // Also what `taken` throws: an unhandled rejection stops the daemon.
          .catch((error: unknown) => session.end(problemText(error)))
          .finally(() => {
            session.taking = false;
          });
      }
      cancelTick = deps.clock.setTimeout(tick, PICTURE_INTERVAL_MS);
    }

    await push({ type: "ready", streamId, width: size.width, height: size.height });
    cancelTick = deps.clock.setTimeout(tick, PICTURE_INTERVAL_MS);
    await done;
  }

  async function perform(dev: AndroidDevice, message: AndroidInput): Promise<void> {
    if (message.tap) await dev.tap(Math.round(message.tap.x), Math.round(message.tap.y));
    if (message.swipe) {
      const { from, to, durationMs } = message.swipe;
      await dev.swipe(
        { x: Math.round(from.x), y: Math.round(from.y) },
        { x: Math.round(to.x), y: Math.round(to.y) },
        durationMs,
      );
    }
    if (message.key) await dev.key(KEYCODES[message.key]);
    if (message.text) await dev.text(message.text);
  }

  return {
    async attach(subscriber) {
      try {
        await run(subscriber);
      } catch (error) {
        deps.log(`[android] stream failed: ${errorMessage(error)}`);
      }
    },
    async input(message) {
      const session = sessions.get(message.streamId);
      if (!session || device === null) return { ok: false };
      session.heardAt = deps.clock.now();
      if (message.shown !== undefined) {
        session.shown = Math.max(session.shown, Math.min(message.shown, session.sent));
        session.flush();
      }
      try {
        await perform(device, message);
      } catch (error) {
        if (error instanceof DeviceUnreachableError) {
          session.end(UNREACHABLE);
          return { ok: false };
        }
        deps.log(`[android] input refused: ${errorMessage(error)}`);
        return { ok: true, message: errorMessage(error) };
      }
      return { ok: true };
    },
    async stop() {
      closing = true;
      const open = [...sessions.values()];
      for (const session of open) session.end(null);
      await Promise.all(open.map((session) => session.done));
    },
  };
}
