import { expect, test } from "vitest";
import { fakeOffice } from "../../client/scene/fake-office.js";
import { LIGHT_THEME_COLORS } from "../../client/scene/fake-theme.js";
import type { OfficeEvent, PointerStep, RenderEvent, RenderInput } from "../../shared/contracts.js";
import type { RenderFocus, RenderTake } from "../../shared/render.js";
import { createFakeClock, type FakeClock } from "../fake-clock.js";
import type { HubSubscriber } from "../hub.js";
import {
  NO_WEBGL,
  type RenderPage,
  type RenderPageHost,
  type RenderPageInput,
  type RenderViewport,
} from "./page-host.js";
import {
  MAX_UNCONFIRMED,
  SILENCE_LIMIT_MS,
  TAKE_INTERVAL_MS,
  createRenderSessions,
  deviceScaleFactor,
  type RenderSessions,
} from "./sessions.js";

const INPUT: RenderInput = {
  width: 390,
  height: 700,
  pixelRatio: 3,
  colors: LIGHT_THEME_COLORS,
  coarsePointer: true,
};
const NOTHING: RenderTake = { picture: null, events: [] };
const SNAPSHOT: OfficeEvent = { type: "snapshot", state: fakeOffice() };

function picture(name: string): RenderTake {
  return { picture: { jpeg: name, width: 585, height: 1050 }, events: [] };
}

/** Lets promises that are already settled run their continuations. */
async function settle(): Promise<void> {
  for (let index = 0; index < 5; index++) await new Promise((resolve) => setImmediate(resolve));
}

interface FakePage extends RenderPage {
  calls: string[];
  states: OfficeEvent[];
  focuses: RenderFocus[];
  steps: PointerStep[];
  sizes: RenderViewport[];
  /** What the next take() calls answer, in order; then nothing. */
  takes: Array<RenderTake | Error | Promise<RenderTake>>;
  takeCount: number;
  closed: boolean;
  /** The page goes away on its own, as when Chromium restarts. */
  vanish(): void;
}

function fakePage(): FakePage {
  const listeners = new Set<() => void>();
  const page: FakePage = {
    calls: [],
    states: [],
    focuses: [],
    steps: [],
    sizes: [],
    takes: [],
    takeCount: 0,
    closed: false,
    async state(event) {
      page.calls.push(`state:${event.type}`);
      page.states.push(event);
    },
    async focus(target) {
      page.calls.push("focus");
      page.focuses.push(target);
    },
    async pointer(steps) {
      page.calls.push("pointer");
      page.steps.push(...steps);
    },
    async resize(viewport) {
      page.calls.push("resize");
      page.sizes.push(viewport);
    },
    async take() {
      page.takeCount += 1;
      const next = page.takes.shift() ?? NOTHING;
      if (next instanceof Error) throw next;
      return next;
    },
    async close() {
      if (page.closed) return;
      page.closed = true;
      for (const listener of listeners) listener();
    },
    onClosed(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    vanish() {
      page.closed = true;
      for (const listener of listeners) listener();
    },
  };
  return page;
}

interface Setup {
  sessions: RenderSessions;
  clock: FakeClock;
  pages: FakePage[];
  opened: RenderPageInput[];
  hubSubscribers: HubSubscriber[];
  /** Runs `count` take intervals. */
  tick(count?: number): Promise<void>;
}

function setup(options: { host?: "none" | "fails"; openError?: string } = {}): Setup {
  const clock = createFakeClock(1_000_000);
  const pages: FakePage[] = [];
  const opened: RenderPageInput[] = [];
  const hubSubscribers: HubSubscriber[] = [];
  const host: RenderPageHost = {
    async open(input) {
      opened.push(input);
      if (options.host === "fails") throw new Error(options.openError ?? "Chromium is down");
      const page = fakePage();
      pages.push(page);
      return page;
    },
  };
  let streams = 0;
  const sessions = createRenderSessions({
    host: options.host === "none" ? null : host,
    hub: {
      async attach(subscriber) {
        hubSubscribers.push(subscriber);
        await subscriber.push(SNAPSHOT);
        await new Promise<void>((resolve) =>
          subscriber.signal.addEventListener("abort", () => resolve(), { once: true }),
        );
      },
    },
    clock,
    newStreamId: () => `stream-${++streams}`,
    log: () => {},
  });
  return {
    sessions,
    clock,
    pages,
    opened,
    hubSubscribers,
    async tick(count = 1) {
      for (let index = 0; index < count; index++) {
        clock.advance(TAKE_INTERVAL_MS);
        await settle();
      }
    },
  };
}

interface Viewer {
  events: RenderEvent[];
  controller: AbortController;
  done: Promise<void>;
  ended: boolean;
}

async function attach(sessions: RenderSessions, input: RenderInput = INPUT): Promise<Viewer> {
  const controller = new AbortController();
  const viewer: Viewer = {
    events: [],
    controller,
    ended: false,
    done: Promise.resolve(),
  };
  viewer.done = (async () => {
    await sessions.attach(input, {
      signal: controller.signal,
      push: async (event) => {
        viewer.events.push(event);
      },
    });
    viewer.ended = true;
  })();
  await settle();
  return viewer;
}

const typesOf = (viewer: Viewer) => viewer.events.map((event) => event.type);
const picturesOf = (viewer: Viewer) =>
  viewer.events.flatMap((event) =>
    event.type === "picture" ? [`${event.seq}:${event.jpeg}`] : [],
  );
const problemsOf = (viewer: Viewer) =>
  viewer.events.flatMap((event) => (event.type === "problem" ? [event.message] : []));

test("deviceScaleFactor caps at 2 and at 1280 device pixels on the long side", () => {
  expect(deviceScaleFactor({ width: 390, height: 700, pixelRatio: 3 })).toBeCloseTo(1280 / 700);
  expect(deviceScaleFactor({ width: 320, height: 480, pixelRatio: 3 })).toBe(2);
  expect(deviceScaleFactor({ width: 320, height: 480, pixelRatio: 1 })).toBe(1);
  expect(deviceScaleFactor({ width: 1600, height: 900, pixelRatio: 1 })).toBeCloseTo(0.8);
});

test("says whether the host can draw", () => {
  expect(setup().sessions.available()).toBe(true);
  expect(setup({ host: "none" }).sessions.available()).toBe(false);
});

test("refuses when the host has no browser", async () => {
  const { sessions } = setup({ host: "none" });

  const viewer = await attach(sessions);

  expect(viewer.events).toEqual([
    { type: "problem", message: "The host has no browser to draw 3D" },
  ]);
  expect(viewer.ended).toBe(true);
});

test("refuses a third viewer and keeps the first two", async () => {
  const { sessions, pages } = setup();
  const first = await attach(sessions);
  const second = await attach(sessions);

  const third = await attach(sessions);

  expect(problemsOf(third)).toEqual(["Two 3D views are already open on this host"]);
  expect(third.ended).toBe(true);
  expect(pages).toHaveLength(2);
  expect([first.ended, second.ended]).toEqual([false, false]);
});

test("refuses a size that rounds to nothing without opening a page", async () => {
  const { sessions, opened } = setup();

  const viewer = await attach(sessions, { ...INPUT, width: 0.4 });

  expect(problemsOf(viewer)).toEqual(["The 3D view has no size"]);
  expect(opened).toEqual([]);
});

test("opens the page at the viewer's size, with the capped scale factor and its theme", async () => {
  const { sessions, opened } = setup();

  await attach(sessions);

  expect(opened).toEqual([
    {
      viewport: { width: 390, height: 700, deviceScaleFactor: 1280 / 700 },
      colors: LIGHT_THEME_COLORS,
      coarsePointer: true,
    },
  ]);
});

test("sends ready, then feeds the page the snapshot before any change", async () => {
  const { sessions, pages, hubSubscribers } = setup();

  const viewer = await attach(sessions);
  await hubSubscribers[0]!.push({ type: "activity", activity: { a: "Reading" } });

  expect(viewer.events[0]).toEqual({ type: "ready", streamId: "stream-1" });
  expect(pages[0]!.calls).toEqual(["state:snapshot", "state:activity"]);
});

test("moves the camera to the workspace tab's room once the page has the office", async () => {
  const { sessions, pages } = setup();

  await attach(sessions, { ...INPUT, focusRoomId: "w-main" });

  expect(pages[0]!.calls).toEqual(["state:snapshot", "focus"]);
  expect(pages[0]!.focuses).toEqual([{ roomId: "w-main" }]);
});

test("reports a host browser without WebGL in those words", async () => {
  const { sessions } = setup({ host: "fails", openError: NO_WEBGL });

  const viewer = await attach(sessions);

  expect(problemsOf(viewer)).toEqual([NO_WEBGL]);
  expect(viewer.ended).toBe(true);
});

test("a page that cannot open frees its slot", async () => {
  const failing = setup({ host: "fails" });
  for (let index = 0; index < 3; index++) {
    const viewer = await attach(failing.sessions);
    expect(problemsOf(viewer)).toEqual(["The 3D view stopped: Chromium is down"]);
  }
});

test("pushes a picture only when take() has one, with rising seq", async () => {
  const { sessions, pages, tick } = setup();
  const viewer = await attach(sessions);
  pages[0]!.takes.push(NOTHING, picture("a"), NOTHING, picture("b"));

  await tick(4);

  expect(picturesOf(viewer)).toEqual(["1:a", "2:b"]);
  expect(viewer.events.find((event) => event.type === "picture")).toEqual({
    type: "picture",
    seq: 1,
    jpeg: "a",
    width: 585,
    height: 1050,
  });
});

test("holds pictures while two are unconfirmed, and sends the newest once one is confirmed", async () => {
  const { sessions, pages, tick } = setup();
  const viewer = await attach(sessions);
  pages[0]!.takes.push(picture("a"), picture("b"), picture("c"), picture("d"));

  await tick(4);
  expect(MAX_UNCONFIRMED).toBe(2);
  expect(picturesOf(viewer)).toEqual(["1:a", "2:b"]);

  expect(await sessions.input({ streamId: "stream-1", shown: 1 })).toEqual({ ok: true });
  await settle();

  // "c" was replaced by "d" while it waited.
  expect(picturesOf(viewer)).toEqual(["1:a", "2:b", "3:d"]);
});

test("does not start a take() while the last one is still running", async () => {
  const { sessions, pages, tick } = setup();
  await attach(sessions);
  let finish!: (take: RenderTake) => void;
  pages[0]!.takes.push(
    new Promise<RenderTake>((resolve) => {
      finish = resolve;
    }),
  );

  await tick(4);
  expect(pages[0]!.takeCount).toBe(1);

  finish(NOTHING);
  await settle();
  await tick();
  expect(pages[0]!.takeCount).toBe(2);
});

test("turns the page's selections into select events", async () => {
  const { sessions, pages, tick } = setup();
  const viewer = await attach(sessions);
  pages[0]!.takes.push({
    picture: null,
    events: [
      { type: "agent", agentId: "a1" },
      { type: "board", roomId: "w-main" },
    ],
  });

  await tick();

  expect(viewer.events.slice(1)).toEqual([
    { type: "select", target: "agent", id: "a1" },
    { type: "select", target: "board", id: "w-main" },
  ]);
});

test("ends with the page's own problem, such as a lost graphics context", async () => {
  const { sessions, pages, tick } = setup();
  const viewer = await attach(sessions);
  pages[0]!.takes.push({
    picture: null,
    events: [{ type: "problem", message: "the graphics context was lost" }],
  });

  await tick();

  expect(problemsOf(viewer)).toEqual(["The 3D view stopped: the graphics context was lost"]);
  expect(viewer.ended).toBe(true);
  expect(pages[0]!.closed).toBe(true);
});

test("sends pointer steps and a focus to the page", async () => {
  const { sessions, pages } = setup();
  await attach(sessions);
  const steps: PointerStep[] = [
    { type: "down", x: 10, y: 20 },
    { type: "up", x: 10, y: 20 },
  ];

  await sessions.input({ streamId: "stream-1", steps, focus: { agentId: "a1" } });

  expect(pages[0]!.steps).toEqual(steps);
  expect(pages[0]!.focuses).toEqual([{ agentId: "a1" }]);
});

test("resizes the page, with the capped scale factor", async () => {
  const { sessions, pages } = setup();
  await attach(sessions);

  await sessions.input({
    streamId: "stream-1",
    resize: { width: 800, height: 600, pixelRatio: 3 },
  });

  expect(pages[0]!.sizes).toEqual([{ width: 800, height: 600, deviceScaleFactor: 1.6 }]);
});

test("closes the page when the viewer unsubscribes, and frees the slot", async () => {
  const { sessions, pages, hubSubscribers } = setup();
  const first = await attach(sessions);
  await attach(sessions);

  first.controller.abort();
  await settle();

  expect(first.ended).toBe(true);
  expect(pages[0]!.closed).toBe(true);
  expect(hubSubscribers[0]!.signal.aborted).toBe(true);
  // No problem goes to a viewer that left.
  expect(problemsOf(first)).toEqual([]);
  const third = await attach(sessions);
  expect(typesOf(third)).toEqual(["ready"]);
});

test("ends with a problem when the page closes on its own", async () => {
  const { sessions, pages } = setup();
  const viewer = await attach(sessions);

  pages[0]!.vanish();
  await settle();

  expect(problemsOf(viewer)).toEqual(["The 3D view stopped: the host browser closed its page"]);
  expect(viewer.ended).toBe(true);
});

test("ends with a problem when take() rejects", async () => {
  const { sessions, pages, tick } = setup();
  const viewer = await attach(sessions);
  pages[0]!.takes.push(new Error("CDP connection is closed"));

  await tick();

  expect(problemsOf(viewer)).toEqual(["The 3D view stopped: CDP connection is closed"]);
  expect(pages[0]!.closed).toBe(true);
});

test("closes a session that hears nothing for 30 seconds", async () => {
  const { sessions, pages, clock } = setup();
  const viewer = await attach(sessions);

  clock.advance(SILENCE_LIMIT_MS + TAKE_INTERVAL_MS);
  await settle();

  expect(viewer.ended).toBe(true);
  expect(pages[0]!.closed).toBe(true);
  expect(await sessions.input({ streamId: "stream-1" })).toEqual({ ok: false });
});

test("an input within 30 seconds keeps the session", async () => {
  const { sessions, pages, clock } = setup();
  const viewer = await attach(sessions);

  for (let index = 0; index < 4; index++) {
    clock.advance(SILENCE_LIMIT_MS - 10_000);
    await settle();
    expect(await sessions.input({ streamId: "stream-1" })).toEqual({ ok: true });
  }

  expect(viewer.ended).toBe(false);
  expect(pages[0]!.closed).toBe(false);
});

test("input for an unknown stream answers ok: false", async () => {
  const { sessions } = setup();

  expect(await sessions.input({ streamId: "nope" })).toEqual({ ok: false });
});

test("a viewer that leaves while its page is still opening gets no page left behind", async () => {
  const clock = createFakeClock();
  const page = fakePage();
  let open!: (page: RenderPage) => void;
  const sessions = createRenderSessions({
    host: { open: () => new Promise<RenderPage>((resolve) => (open = resolve)) },
    hub: { attach: async () => {} },
    clock,
    newStreamId: () => "stream-1",
    log: () => {},
  });
  const viewer = await attach(sessions);

  viewer.controller.abort();
  open(page);
  await settle();

  expect(page.closed).toBe(true);
  expect(viewer.ended).toBe(true);
  expect(viewer.events).toEqual([]);
});

test("stop closes every page", async () => {
  const { sessions, pages } = setup();
  const first = await attach(sessions);
  const second = await attach(sessions);

  await sessions.stop();
  await settle();

  expect(pages.map((page) => page.closed)).toEqual([true, true]);
  expect([first.ended, second.ended]).toEqual([true, true]);
});

test("a size in fractions of a pixel, as Android reports it, reaches the browser in whole pixels", async () => {
  const { sessions, opened, pages } = setup();

  await attach(sessions, { ...INPUT, width: 411.43, height: 866.29 });
  await sessions.input({
    streamId: "stream-1",
    resize: { width: 392.73, height: 0.4, pixelRatio: 2 },
  });
  await sessions.input({
    streamId: "stream-1",
    resize: { width: 392.73, height: 850.9, pixelRatio: 2 },
  });

  expect(opened[0]!.viewport).toEqual({ width: 411, height: 866, deviceScaleFactor: 1280 / 866 });
  // A size that rounds to nothing is not sent.
  expect(pages[0]!.sizes).toEqual([{ width: 393, height: 851, deviceScaleFactor: 1280 / 851 }]);
});

test("a take() that answers with something malformed ends the session and rejects nothing", async () => {
  const { sessions, pages, tick } = setup();
  const viewer = await attach(sessions);
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  pages[0]!.takes.push({ picture: null } as never);

  await tick(2);
  process.off("unhandledRejection", onUnhandled);

  expect(unhandled).toEqual([]);
  expect(viewer.ended).toBe(true);
  expect(pages[0]!.closed).toBe(true);
});
