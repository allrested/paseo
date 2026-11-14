import { expect, test } from "vitest";
import { fakeOffice } from "../../client/scene/fake-office.js";
import { LIGHT_THEME_COLORS } from "../../client/scene/fake-theme.js";
import type { OfficeEvent, SheetEvent, SheetInput } from "../../shared/contracts.js";
import type { Sheet, SheetSize, SheetTake, SheetTile, SpritePicture } from "../../shared/sheet.js";
import { createFakeClock, type FakeClock } from "../fake-clock.js";
import type { HubSubscriber } from "../hub.js";
import { NO_WEBGL } from "./page-host.js";
import type { SheetPage, SheetPageHost } from "./sheet-page-host.js";
import {
  SHEET_SILENCE_LIMIT_MS,
  createSheetSessions,
  type SheetSessions,
} from "./sheet-sessions.js";

const INPUT: SheetInput = { width: 390, height: 700, pixelRatio: 3, colors: LIGHT_THEME_COLORS };
const SNAPSHOT: OfficeEvent = { type: "snapshot", state: fakeOffice() };
const SPRITE: SpritePicture = {
  png: "p",
  frames: 1,
  columns: 1,
  frameWidth: 8,
  frameHeight: 8,
  frameMs: 0,
  loop: true,
  scale: 1,
};

function tile(index: number): SheetTile {
  return {
    version: 1,
    index,
    x: index * 10,
    y: 0,
    width: 10,
    height: 10,
    jpeg: "j",
    overlay: null,
  };
}

const sheet = (version: number) => ({ version }) as Sheet;
const take = (tiles: SheetTile[], sheetValue: Sheet | null): SheetTake => ({
  tiles,
  sheet: sheetValue,
  problem: null,
});
const NOTHING: SheetTake = take([], null);

/** Lets promises that are already settled run their continuations. */
async function settle(): Promise<void> {
  for (let index = 0; index < 5; index++) await new Promise((resolve) => setImmediate(resolve));
}

interface FakePage extends SheetPage {
  calls: string[];
  sizes: SheetSize[];
  /** What the next take() calls answer, in order; then nothing. */
  takes: Array<SheetTake | Error | Promise<SheetTake>>;
  takeCount: number;
  sprites: Array<SpritePicture | null | Error>;
  closed: boolean;
}

function fakePage(): FakePage {
  const listeners = new Set<() => void>();
  const page: FakePage = {
    calls: [],
    sizes: [],
    takes: [],
    takeCount: 0,
    sprites: [],
    closed: false,
    async size(size) {
      page.calls.push("size");
      page.sizes.push(size);
    },
    async state(event) {
      page.calls.push(`state:${event.type}`);
    },
    async take() {
      page.calls.push("take");
      page.takeCount += 1;
      const next = page.takes.shift() ?? NOTHING;
      if (next instanceof Error) throw next;
      return next;
    },
    async sprite() {
      const next = page.sprites.shift() ?? null;
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
  };
  return page;
}

interface Setup {
  sessions: SheetSessions;
  clock: FakeClock;
  pages: FakePage[];
  hubSubscribers: HubSubscriber[];
}

function setup(
  options: { host?: "none" | "fails"; openError?: string; firstTakes?: SheetTake[] } = {},
): Setup {
  const clock = createFakeClock(1_000_000);
  const pages: FakePage[] = [];
  const hubSubscribers: HubSubscriber[] = [];
  const host: SheetPageHost = {
    async open() {
      if (options.host === "fails") throw new Error(options.openError ?? "Chromium is down");
      const page = fakePage();
      page.takes.push(...(options.firstTakes ?? []));
      pages.push(page);
      return page;
    },
  };
  let sheets = 0;
  const sessions = createSheetSessions({
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
    newSheetId: () => `sheet-${++sheets}`,
    log: () => {},
  });
  return { sessions, clock, pages, hubSubscribers };
}

interface Viewer {
  events: SheetEvent[];
  controller: AbortController;
  ended: boolean;
}

/** Starts a viewer and lets its session get going. */
async function attach(sessions: SheetSessions, input: SheetInput = INPUT): Promise<Viewer> {
  const controller = new AbortController();
  const viewer: Viewer = { events: [], controller, ended: false };
  void (async () => {
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
const problemsOf = (viewer: Viewer) =>
  viewer.events.flatMap((event) => (event.type === "problem" ? [event.message] : []));

test("ready, then the tiles of a take, then its sheet, in that order", async () => {
  // The first take is the one the snapshot causes.
  const { sessions, pages } = setup({ firstTakes: [take([tile(0), tile(1)], sheet(1))] });
  const controller = new AbortController();
  const events: SheetEvent[] = [];

  void sessions.attach(INPUT, {
    signal: controller.signal,
    push: async (e) => void events.push(e),
  });
  await settle();

  expect(events.map((event) => event.type)).toEqual(["ready", "tile", "tile", "sheet"]);
  expect(events[0]).toEqual({ type: "ready", sheetId: "sheet-1" });
  expect(events.flatMap((event) => (event.type === "tile" ? [event.tile.index] : []))).toEqual([
    0, 1,
  ]);
  expect(pages[0]!.calls).toEqual(["size", "state:snapshot", "take"]);
  controller.abort();
});

test("takes never overlap, and changes during a take cause one more", async () => {
  const { sessions, pages, hubSubscribers } = setup();
  await attach(sessions);
  let finish!: (value: SheetTake) => void;
  pages[0]!.takes.push(
    new Promise<SheetTake>((resolve) => {
      finish = resolve;
    }),
  );
  const before = pages[0]!.takeCount;

  const changes = [1, 2, 3].map(() =>
    hubSubscribers[0]!.push({ type: "activity", activity: { a: "Reading" } }),
  );
  await settle();
  expect(pages[0]!.takeCount).toBe(before + 1);

  finish(NOTHING);
  await Promise.all(changes);
  await settle();

  // One take for the first change, one for the three that came while it ran.
  expect(pages[0]!.takeCount).toBe(before + 2);
});

test("a third viewer is refused", async () => {
  const { sessions, pages } = setup();
  const first = await attach(sessions);
  const second = await attach(sessions);

  const third = await attach(sessions);

  expect(problemsOf(third)).toEqual(["Two 3D views are already open on this host"]);
  expect(third.ended).toBe(true);
  expect(pages).toHaveLength(2);
  expect([first.ended, second.ended]).toEqual([false, false]);
});

test("a viewer that says nothing for 30 seconds is closed without a problem", async () => {
  const { sessions, pages, clock } = setup();
  const viewer = await attach(sessions);

  clock.advance(SHEET_SILENCE_LIMIT_MS + 5_000);
  await settle();

  expect(viewer.ended).toBe(true);
  expect(pages[0]!.closed).toBe(true);
  expect(problemsOf(viewer)).toEqual([]);
  expect(await sessions.input({ sheetId: "sheet-1" })).toEqual({ ok: false });
});

test("a resize reaches the page in whole pixels and is followed by a take", async () => {
  const { sessions, pages } = setup();
  await attach(sessions, { ...INPUT, width: 411.43, height: 866.29 });
  const before = pages[0]!.takeCount;

  const ignored = await sessions.input({
    sheetId: "sheet-1",
    resize: { width: 392.73, height: 0.4, pixelRatio: 2 },
  });
  const heard = await sessions.input({
    sheetId: "sheet-1",
    resize: { width: 392.73, height: 850.9, pixelRatio: 2 },
  });

  expect([ignored, heard]).toEqual([{ ok: true }, { ok: true }]);
  expect(pages[0]!.sizes).toEqual([
    { width: 411, height: 866, pixelRatio: 3 },
    { width: 393, height: 851, pixelRatio: 2 },
  ]);
  // A size that rounds to nothing is not sent, and causes no take.
  expect(pages[0]!.takeCount).toBe(before + 1);
  expect(pages[0]!.calls.slice(-2)).toEqual(["size", "take"]);
});

test("the page is closed when the subscriber leaves", async () => {
  const { sessions, pages, hubSubscribers } = setup();
  const first = await attach(sessions);
  await attach(sessions);

  first.controller.abort();
  await settle();

  expect(first.ended).toBe(true);
  expect(pages[0]!.closed).toBe(true);
  expect(hubSubscribers[0]!.signal.aborted).toBe(true);
  // No problem goes to a viewer that left, and its slot is free.
  expect(problemsOf(first)).toEqual([]);
  expect(typesOf(await attach(sessions))).toContain("ready");
});

test("a page that throws ends the sheet with a problem", async () => {
  const { sessions, pages, hubSubscribers } = setup();
  const viewer = await attach(sessions);
  pages[0]!.takes.push(new Error("CDP connection is closed"));

  await hubSubscribers[0]!.push({ type: "activity", activity: {} });
  await settle();

  expect(problemsOf(viewer)).toEqual(["The 3D view stopped: CDP connection is closed"]);
  expect(viewer.ended).toBe(true);
  expect(pages[0]!.closed).toBe(true);
});

test("a take that reports a problem ends the sheet", async () => {
  const { sessions, pages, hubSubscribers } = setup();
  const viewer = await attach(sessions);
  pages[0]!.takes.push({
    tiles: [tile(0)],
    sheet: null,
    problem: "the graphics context was lost",
  });

  await hubSubscribers[0]!.push({ type: "activity", activity: {} });
  await settle();

  expect(problemsOf(viewer)).toEqual(["The 3D view stopped: the graphics context was lost"]);
  // Nothing from a failed take is sent.
  expect(typesOf(viewer)).toEqual(["ready", "problem"]);
  expect(viewer.ended).toBe(true);
  expect(pages[0]!.closed).toBe(true);
});

test("a sprite for an unknown sheet is null, and a sprite that throws is null without ending the sheet", async () => {
  const { sessions, pages } = setup();
  const viewer = await attach(sessions);
  pages[0]!.sprites.push(SPRITE, new Error("no such look"));

  expect(await sessions.sprite({ sheetId: "nope", key: "a" })).toBeNull();
  expect(await sessions.sprite({ sheetId: "sheet-1", key: "a" })).toEqual(SPRITE);
  expect(await sessions.sprite({ sheetId: "sheet-1", key: "b" })).toBeNull();

  expect(viewer.ended).toBe(false);
  expect(pages[0]!.closed).toBe(false);
});

test("a host without a browser refuses", async () => {
  const { sessions } = setup({ host: "none" });

  const viewer = await attach(sessions);

  expect(sessions.available()).toBe(false);
  expect(viewer.events).toEqual([
    { type: "problem", message: "The host has no browser to draw 3D" },
  ]);
  expect(viewer.ended).toBe(true);
});

test("a host browser without WebGL is reported in those words, and a failed open frees its slot", async () => {
  const { sessions } = setup({ host: "fails", openError: NO_WEBGL });
  for (let index = 0; index < 3; index++) {
    expect(problemsOf(await attach(sessions))).toEqual([NO_WEBGL]);
  }
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
