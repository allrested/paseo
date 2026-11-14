// One sheet per viewer: a sheet page in the daemon's Chromium, fed the office state, asked for what
// changed after every event. The viewer gets pictures and positions, not frames. Runs in the daemon
// process: nothing here may throw out of a timer or a handler.
import type {
  OfficeEvent,
  RenderSize,
  SheetEvent,
  SheetInput,
  SheetInputMessage,
  SheetSpriteMessage,
} from "../../shared/contracts.js";
import type { SpritePicture } from "../../shared/sheet.js";
import { errorMessage } from "../errors.js";
import type { Hub } from "../hub.js";
import type { Clock } from "../timers.js";
import { NO_WEBGL } from "./page-host.js";
import type { SheetPage, SheetPageHost } from "./sheet-page-host.js";

export const MAX_SHEET_SESSIONS = 2;
/** A viewer that says nothing for this long is gone: a locked phone, a dropped link. */
export const SHEET_SILENCE_LIMIT_MS = 30_000;
const SILENCE_CHECK_MS = 5_000;

const NO_BROWSER = "The host has no browser to draw 3D";
const FULL = "Two 3D views are already open on this host";
const NO_SIZE = "The 3D view has no size";
const stopped = (reason: string) => `The 3D view stopped: ${reason}`;

/**
 * The size in whole CSS pixels: Chromium takes no fractions, and a phone reports them
 * (411.43 x 866.29). Null for a size that rounds to nothing.
 */
function wholeSize(size: RenderSize): RenderSize | null {
  const width = Math.round(size.width);
  const height = Math.round(size.height);
  return width >= 1 && height >= 1 ? { width, height, pixelRatio: size.pixelRatio } : null;
}

export interface SheetSubscriber {
  push(event: SheetEvent): Promise<void>;
  signal: AbortSignal;
}

export interface SheetSessions {
  available(): boolean;
  /** Runs one viewer's sheet; resolves when it ends. Never rejects. */
  attach(input: SheetInput, subscriber: SheetSubscriber): Promise<void>;
  input(message: SheetInputMessage): Promise<{ ok: boolean }>;
  sprite(message: SheetSpriteMessage): Promise<SpritePicture | null>;
  stop(): Promise<void>;
}

export interface SheetSessionsDeps {
  /** Null when the daemon has no Chromium. */
  host: SheetPageHost | null;
  hub: Pick<Hub, "attach">;
  clock: Clock;
  newSheetId(): string;
  log(message: string): void;
}

interface Session {
  page: SheetPage;
  /** When the viewer was last heard from. */
  heardAt: number;
  /** Resolves once the session ended and its page is closed. */
  done: Promise<void>;
  end(problem: string | null): void;
  /** Asks the page what changed and sends it. */
  pump(): Promise<void>;
}

export function createSheetSessions(deps: SheetSessionsDeps): SheetSessions {
  const sessions = new Map<string, Session>();
  /** Viewers whose page is still opening hold a slot too. */
  let opening = 0;

  async function run(input: SheetInput, subscriber: SheetSubscriber): Promise<void> {
    const push = async (event: SheetEvent): Promise<void> => {
      if (subscriber.signal.aborted) return;
      try {
        await subscriber.push(event);
      } catch (error) {
        deps.log(`[office] sheet push failed: ${errorMessage(error)}`);
      }
    };
    const refuse = (message: string) => push({ type: "problem", message });

    if (deps.host === null) return refuse(NO_BROWSER);
    if (sessions.size + opening >= MAX_SHEET_SESSIONS) return refuse(FULL);
    const size = wholeSize(input);
    if (size === null) return refuse(NO_SIZE);

    let page: SheetPage;
    opening += 1;
    try {
      page = await deps.host.open({ colors: input.colors });
      try {
        await page.size(size);
      } catch (error) {
        await page.close().catch(() => undefined);
        throw error;
      }
    } catch (error) {
      const message = errorMessage(error);
      deps.log(`[office] sheet page failed to open: ${message}`);
      return refuse(message === NO_WEBGL ? NO_WEBGL : stopped(message));
    } finally {
      opening -= 1;
    }
    if (subscriber.signal.aborted) {
      await page.close().catch(() => undefined);
      return;
    }

    const sheetId = deps.newSheetId();
    const feed = new AbortController();
    let cancelCheck: (() => void) | null = null;
    let ended = false;
    let pumping = false;
    let again = false;
    let finish!: () => void;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });

    const session: Session = {
      page,
      heardAt: deps.clock.now(),
      done,
      end(problem) {
        if (ended) return;
        ended = true;
        cancelCheck?.();
        sessions.delete(sheetId);
        feed.abort();
        if (problem !== null) deps.log(`[office] sheet ${sheetId} ended: ${problem}`);
        const tell = problem === null ? Promise.resolve() : refuse(stopped(problem));
        void tell
          .then(() => page.close())
          .catch((error: unknown) =>
            deps.log(`[office] sheet page failed to close: ${errorMessage(error)}`),
          )
          .then(finish);
      },
      async pump() {
        // A change during a take is not lost: it makes one more take after this one.
        if (ended) return;
        if (pumping) {
          again = true;
          return;
        }
        pumping = true;
        try {
          for (;;) {
            again = false;
            const take = await page.take();
            if (ended) return;
            if (take.problem !== null) {
              session.end(take.problem);
              return;
            }
            for (const tile of take.tiles) await push({ type: "tile", tile });
            if (take.sheet !== null) await push({ type: "sheet", sheet: take.sheet });
            if (!again || ended) return;
          }
        } catch (error) {
          // Also what a malformed answer throws: an unhandled rejection stops the daemon.
          session.end(errorMessage(error));
        } finally {
          pumping = false;
        }
      },
    };
    sessions.set(sheetId, session);
    subscriber.signal.addEventListener("abort", () => session.end(null), { once: true });
    page.onClosed(() => session.end("the host browser closed its page"));

    function check(): void {
      cancelCheck = null;
      if (ended) return;
      if (deps.clock.now() - session.heardAt > SHEET_SILENCE_LIMIT_MS) {
        // Nobody is there to tell.
        deps.log(`[office] sheet ${sheetId} closed: its viewer went silent`);
        session.end(null);
        return;
      }
      cancelCheck = deps.clock.setTimeout(check, SILENCE_CHECK_MS);
    }

    await push({ type: "ready", sheetId });
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
        await session.pump();
      },
    });
    fed.catch((error: unknown) => session.end(errorMessage(error)));
    cancelCheck = deps.clock.setTimeout(check, SILENCE_CHECK_MS);
    await done;
  }

  return {
    available: () => deps.host !== null,
    async attach(input, subscriber) {
      try {
        await run(input, subscriber);
      } catch (error) {
        deps.log(`[office] sheet session failed: ${errorMessage(error)}`);
      }
    },
    async input(message) {
      const session = sessions.get(message.sheetId);
      if (!session) return { ok: false };
      session.heardAt = deps.clock.now();
      try {
        const resized = message.resize ? wholeSize(message.resize) : null;
        if (resized !== null) {
          await session.page.size(resized);
          await session.pump();
        }
      } catch (error) {
        session.end(errorMessage(error));
        return { ok: false };
      }
      return { ok: true };
    },
    async sprite(message) {
      const session = sessions.get(message.sheetId);
      if (!session) return null;
      session.heardAt = deps.clock.now();
      try {
        return await session.page.sprite(message.key);
      } catch (error) {
        // One bad sprite is not worth the viewer's sheet.
        deps.log(`[office] sheet sprite failed: ${errorMessage(error)}`);
        return null;
      }
    },
    async stop() {
      const open = [...sessions.values()];
      for (const session of open) session.end(null);
      await Promise.all(open.map((session) => session.done));
    },
  };
}
