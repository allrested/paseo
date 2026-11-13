// One streamed 3D view per viewer: a render page in the daemon's Chromium, fed the office state,
// asked for a picture 8 times a second. Runs in the daemon process: nothing here may throw out of
// a timer or a handler.
import type {
  OfficeEvent,
  RenderEvent,
  RenderInput,
  RenderInputMessage,
  RenderSize,
} from "../../shared/contracts.js";
import type { RenderPicture, RenderTake } from "../../shared/render.js";
import { errorMessage } from "../errors.js";
import type { Hub } from "../hub.js";
import type { Clock } from "../timers.js";
import {
  NO_WEBGL,
  type RenderPage,
  type RenderPageHost,
  type RenderViewport,
} from "./page-host.js";

export const MAX_RENDER_SESSIONS = 2;
export const TAKE_INTERVAL_MS = 125;
/** Pictures sent that the viewer has not confirmed; more wait, and only the newest is kept. */
export const MAX_UNCONFIRMED = 2;
/** A viewer that says nothing for this long is gone: a locked phone, a dropped link. */
export const SILENCE_LIMIT_MS = 30_000;
export const MAX_PICTURE_SIDE = 1280;
const MAX_SCALE = 2;

const NO_BROWSER = "The host has no browser to draw 3D";
const FULL = "Two 3D views are already open on this host";
const NO_SIZE = "The 3D view has no size";
const stopped = (reason: string) => `The 3D view stopped: ${reason}`;

/** Keeps a picture at most 1280 device pixels on its long side, and at most 2 per CSS pixel. */
export function deviceScaleFactor(size: RenderSize): number {
  return Math.min(size.pixelRatio, MAX_SCALE, MAX_PICTURE_SIDE / Math.max(size.width, size.height));
}

function viewportOf(size: RenderSize): RenderViewport {
  return { width: size.width, height: size.height, deviceScaleFactor: deviceScaleFactor(size) };
}

function hasSize(size: RenderSize): boolean {
  return size.width >= 1 && size.height >= 1;
}

export interface RenderSubscriber {
  push(event: RenderEvent): Promise<void>;
  signal: AbortSignal;
}

export interface RenderSessions {
  available(): boolean;
  /** Runs one viewer's stream; resolves when it ends. Never rejects. */
  attach(input: RenderInput, subscriber: RenderSubscriber): Promise<void>;
  input(message: RenderInputMessage): Promise<{ ok: boolean }>;
  stop(): Promise<void>;
}

export interface RenderSessionsDeps {
  /** Null when the daemon has no Chromium. */
  host: RenderPageHost | null;
  hub: Pick<Hub, "attach">;
  clock: Clock;
  newStreamId(): string;
  log(message: string): void;
}

interface Session {
  page: RenderPage;
  /** When the viewer was last heard from. */
  heardAt: number;
  sent: number;
  shown: number;
  /** A picture drawn while two were unconfirmed; a newer one replaces it. */
  waiting: RenderPicture | null;
  taking: boolean;
  /** Resolves once the session ended and its page is closed. */
  done: Promise<void>;
  end(problem: string | null): void;
  flush(): void;
}

export function createRenderSessions(deps: RenderSessionsDeps): RenderSessions {
  const sessions = new Map<string, Session>();
  /** Viewers whose page is still opening hold a slot too. */
  let opening = 0;

  async function run(input: RenderInput, subscriber: RenderSubscriber): Promise<void> {
    const push = async (event: RenderEvent): Promise<void> => {
      if (subscriber.signal.aborted) return;
      try {
        await subscriber.push(event);
      } catch (error) {
        deps.log(`[office] render push failed: ${errorMessage(error)}`);
      }
    };
    const refuse = (message: string) => push({ type: "problem", message });

    if (deps.host === null) return refuse(NO_BROWSER);
    if (sessions.size + opening >= MAX_RENDER_SESSIONS) return refuse(FULL);
    if (!hasSize(input)) return refuse(NO_SIZE);

    let page: RenderPage;
    opening += 1;
    try {
      page = await deps.host.open({
        viewport: viewportOf(input),
        colors: input.colors,
        coarsePointer: input.coarsePointer,
      });
    } catch (error) {
      const message = errorMessage(error);
      deps.log(`[office] render page failed to open: ${message}`);
      return refuse(message === NO_WEBGL ? NO_WEBGL : stopped(message));
    } finally {
      opening -= 1;
    }
    if (subscriber.signal.aborted) {
      await page.close().catch(() => undefined);
      return;
    }

    const streamId = deps.newStreamId();
    const feed = new AbortController();
    let cancelTick: (() => void) | null = null;
    let ended = false;
    let finish!: () => void;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });

    const session: Session = {
      page,
      heardAt: deps.clock.now(),
      sent: 0,
      shown: 0,
      waiting: null,
      taking: false,
      done,
      end(problem) {
        if (ended) return;
        ended = true;
        cancelTick?.();
        sessions.delete(streamId);
        feed.abort();
        if (problem !== null) deps.log(`[office] render ${streamId} ended: ${problem}`);
        const tell = problem === null ? Promise.resolve() : refuse(stopped(problem));
        void tell
          .then(() => page.close())
          .catch((error: unknown) =>
            deps.log(`[office] render page failed to close: ${errorMessage(error)}`),
          )
          .then(finish);
      },
      flush() {
        if (ended || session.waiting === null) return;
        if (session.sent - session.shown >= MAX_UNCONFIRMED) return;
        const { jpeg, width, height } = session.waiting;
        session.waiting = null;
        session.sent += 1;
        void push({ type: "picture", seq: session.sent, jpeg, width, height });
      },
    };
    sessions.set(streamId, session);
    subscriber.signal.addEventListener("abort", () => session.end(null), { once: true });
    page.onClosed(() => session.end("the host browser closed its page"));

    function taken(take: RenderTake): void {
      for (const event of take.events) {
        if (event.type === "problem") {
          session.end(event.message);
          return;
        }
        void push(
          event.type === "agent"
            ? { type: "select", target: "agent", id: event.agentId }
            : { type: "select", target: "board", id: event.roomId },
        );
      }
      if (take.picture !== null) session.waiting = take.picture;
      session.flush();
    }

    function tick(): void {
      cancelTick = null;
      if (ended) return;
      if (deps.clock.now() - session.heardAt > SILENCE_LIMIT_MS) {
        // Nobody is there to tell.
        deps.log(`[office] render ${streamId} closed: its viewer went silent`);
        session.end(null);
        return;
      }
      if (!session.taking) {
        session.taking = true;
        page
          .take()
          .then(taken, (error: unknown) => session.end(errorMessage(error)))
          .finally(() => {
            session.taking = false;
          });
      }
      cancelTick = deps.clock.setTimeout(tick, TAKE_INTERVAL_MS);
    }

    await push({ type: "ready", streamId });
    // The page is a headless office client: it takes the snapshot and every change, in order.
    const fed = deps.hub.attach({
      signal: feed.signal,
      push: async (event: OfficeEvent) => {
        if (ended) return;
        try {
          await page.state(event);
        } catch (error) {
          session.end(errorMessage(error));
          return;
        }
        if (event.type === "snapshot" && input.focusRoomId !== undefined) {
          await page
            .focus({ roomId: input.focusRoomId })
            .catch((error: unknown) => session.end(errorMessage(error)));
        }
      },
    });
    fed.catch((error: unknown) => session.end(errorMessage(error)));
    cancelTick = deps.clock.setTimeout(tick, TAKE_INTERVAL_MS);
    await done;
  }

  return {
    available: () => deps.host !== null,
    async attach(input, subscriber) {
      try {
        await run(input, subscriber);
      } catch (error) {
        deps.log(`[office] render session failed: ${errorMessage(error)}`);
      }
    },
    async input(message) {
      const session = sessions.get(message.streamId);
      if (!session) return { ok: false };
      session.heardAt = deps.clock.now();
      if (message.shown !== undefined) {
        session.shown = Math.max(session.shown, Math.min(message.shown, session.sent));
        session.flush();
      }
      try {
        if (message.resize && hasSize(message.resize)) {
          await session.page.resize(viewportOf(message.resize));
        }
        if (message.steps && message.steps.length > 0) await session.page.pointer(message.steps);
        if (message.focus) await session.page.focus(message.focus);
      } catch (error) {
        session.end(errorMessage(error));
        return { ok: false };
      }
      return { ok: true };
    },
    async stop() {
      const open = [...sessions.values()];
      for (const session of open) session.end(null);
      await Promise.all(open.map((session) => session.done));
    },
  };
}
