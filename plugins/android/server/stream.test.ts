import { expect, test } from "vitest";
import type { AndroidInput, AndroidStreamEvent } from "../shared/contracts.js";
import type { AndroidDevice } from "./device.js";
import { DeviceUnreachableError } from "./errors.js";
import { createFakeClock, settle, type FakeClock } from "./fake-clock.js";
import {
  MAX_UNCONFIRMED,
  MAX_VIEWERS,
  PICTURE_INTERVAL_MS,
  SILENCE_LIMIT_MS,
  createAndroidStreams,
  type AndroidStreams,
} from "./stream.js";

const png = (label: string) => Buffer.from(label);
const b64 = (label: string) => png(label).toString("base64");

interface FakeDevice extends AndroidDevice {
  /** What the next screenshots return, in order; the last is repeated. */
  screens: Array<Buffer | Error>;
  screenshots: number;
  calls: string[];
  /** When set, screenshot() waits for it. */
  gate: Promise<void> | null;
  inFlight: number;
  maxInFlight: number;
  sizeError: Error | null;
  failNext: Error | null;
}

function fakeDevice(): FakeDevice {
  const device: FakeDevice = {
    screens: [png("a")],
    screenshots: 0,
    calls: [],
    gate: null,
    inFlight: 0,
    maxInFlight: 0,
    sizeError: null,
    failNext: null,
    async ensure() {},
    async shell() {
      return "";
    },
    async screenshot() {
      device.screenshots += 1;
      device.inFlight += 1;
      device.maxInFlight = Math.max(device.maxInFlight, device.inFlight);
      try {
        if (device.gate) await device.gate;
        const next = device.screens.length > 1 ? device.screens.shift()! : device.screens[0]!;
        if (next instanceof Error) throw next;
        return next;
      } finally {
        device.inFlight -= 1;
      }
    },
    async dump() {
      return "";
    },
    async focus() {
      return { packageName: null, activity: null };
    },
    async tap(x, y) {
      if (device.failNext) throw device.failNext;
      device.calls.push(`tap ${x} ${y}`);
    },
    async swipe(from, to, durationMs) {
      device.calls.push(`swipe ${from.x},${from.y} ${to.x},${to.y} ${durationMs}`);
    },
    async key(keycode) {
      device.calls.push(`key ${keycode}`);
    },
    async text(value) {
      device.calls.push(`text ${value}`);
    },
    async install() {},
    async launch() {},
    async stop() {},
    async logs() {
      return "";
    },
    async size() {
      if (device.sizeError) throw device.sizeError;
      return { width: 720, height: 1280 };
    },
  };
  return device;
}

interface Setup {
  streams: AndroidStreams;
  device: FakeDevice;
  clock: FakeClock;
  tick(count?: number): Promise<void>;
}

function setup(options: { noDevice?: boolean } = {}): Setup {
  const clock = createFakeClock(1_000_000);
  const device = fakeDevice();
  let count = 0;
  const streams = createAndroidStreams({
    device: options.noDevice ? null : device,
    clock,
    newStreamId: () => `stream-${++count}`,
    log: () => {},
  });
  return {
    streams,
    device,
    clock,
    async tick(times = 1) {
      for (let index = 0; index < times; index++) {
        clock.advance(PICTURE_INTERVAL_MS);
        await settle();
      }
    },
  };
}

interface Viewer {
  events: AndroidStreamEvent[];
  controller: AbortController;
  ended: boolean;
}

async function attach(streams: AndroidStreams): Promise<Viewer> {
  const controller = new AbortController();
  const viewer: Viewer = { events: [], controller, ended: false };
  void streams
    .attach({
      signal: controller.signal,
      push: async (event) => {
        viewer.events.push(event);
      },
    })
    .then(() => {
      viewer.ended = true;
      return undefined;
    });
  await settle();
  return viewer;
}

const pictures = (viewer: Viewer) =>
  viewer.events.flatMap((event) => (event.type === "picture" ? [`${event.seq}:${event.png}`] : []));
const problems = (viewer: Viewer) =>
  viewer.events.flatMap((event) => (event.type === "problem" ? [event.message] : []));
const input = (message: Partial<AndroidInput>, streamId = "stream-1") => ({
  streamId,
  ...message,
});

test("refuses with no device", async () => {
  const { streams } = setup({ noDevice: true });

  const viewer = await attach(streams);

  expect(problems(viewer)).toEqual(["No Android device on this host"]);
  expect(viewer.ended).toBe(true);
});

test("refuses a third viewer and keeps the first two", async () => {
  const { streams } = setup();
  const first = await attach(streams);
  const second = await attach(streams);

  const third = await attach(streams);

  expect(MAX_VIEWERS).toBe(2);
  expect(problems(third)).toEqual(["Two Android views are already open on this host"]);
  expect(third.ended).toBe(true);
  expect([first.ended, second.ended]).toEqual([false, false]);
});

test("a viewer still opening holds a slot", async () => {
  const { streams, device } = setup();
  let release!: () => void;
  const sizing = new Promise<void>((resolve) => {
    release = resolve;
  });
  const size = device.size;
  device.size = async () => {
    await sizing;
    return size();
  };
  const first = await attach(streams);
  const second = await attach(streams);

  const third = await attach(streams);
  expect(problems(third)).toHaveLength(1);

  release();
  await settle();
  expect(first.events[0]?.type).toBe("ready");
  expect(second.events[0]?.type).toBe("ready");
});

test("ready carries the device's size", async () => {
  const { streams } = setup();

  const viewer = await attach(streams);

  expect(viewer.events).toEqual([
    { type: "ready", streamId: "stream-1", width: 720, height: 1280 },
  ]);
});

test("a device that cannot say its size ends the stream with the unreachable text", async () => {
  const { streams, device } = setup();
  device.sizeError = new DeviceUnreachableError();

  const viewer = await attach(streams);

  expect(problems(viewer)).toEqual(["The Android device is unreachable"]);
  expect(viewer.ended).toBe(true);
  device.sizeError = null;
  expect((await attach(streams)).events[0]?.type).toBe("ready");
});

test("sends the first picture at the first tick, and none while the screen is unchanged", async () => {
  const { streams, tick } = setup();
  const viewer = await attach(streams);

  await tick(4);

  expect(pictures(viewer)).toEqual([`1:${b64("a")}`]);
});

test("a changed screen sends one picture", async () => {
  const { streams, device, tick } = setup();
  const viewer = await attach(streams);
  await tick(2);

  device.screens = [png("b")];
  await tick(3);

  expect(pictures(viewer)).toEqual([`1:${b64("a")}`, `2:${b64("b")}`]);
});

test("each viewer is compared with the last picture sent to it", async () => {
  const { streams, tick } = setup();
  const first = await attach(streams);
  await tick(2);
  const second = await attach(streams);

  await tick(2);

  expect(pictures(first)).toEqual([`1:${b64("a")}`]);
  expect(pictures(second)).toEqual([`1:${b64("a")}`]);
});

test("holds at two unconfirmed and sends the newest after a confirmation", async () => {
  const { streams, device, tick } = setup();
  const viewer = await attach(streams);
  device.screens = [png("a"), png("b"), png("c"), png("d")];

  await tick(4);
  expect(MAX_UNCONFIRMED).toBe(2);
  expect(pictures(viewer)).toEqual([`1:${b64("a")}`, `2:${b64("b")}`]);

  expect(await streams.input(input({ shown: 1 }))).toEqual({ ok: true });
  await settle();

  // "c" was replaced by "d" while it waited.
  expect(pictures(viewer)).toEqual([`1:${b64("a")}`, `2:${b64("b")}`, `3:${b64("d")}`]);
});

test("a picture waiting that equals the last one sent is dropped", async () => {
  const { streams, device, tick } = setup();
  const viewer = await attach(streams);
  device.screens = [png("a"), png("b"), png("c"), png("b")];
  await tick(4);
  // "c" waits, then the screen is back at "b", which the viewer already has.
  expect(pictures(viewer)).toHaveLength(2);

  await streams.input(input({ shown: 2 }));
  await settle();

  expect(pictures(viewer)).toHaveLength(2);
});

test("does not take a screenshot while the last one is still running", async () => {
  const { streams, device, tick } = setup();
  await attach(streams);
  let release!: () => void;
  device.gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  await tick(6);
  expect(device.screenshots).toBe(1);

  device.gate = null;
  release();
  await settle();
  await tick();
  expect(device.screenshots).toBe(2);
  expect(device.maxInFlight).toBe(1);
});

test("a device that goes away ends the stream with the unreachable text", async () => {
  const { streams, device, tick } = setup();
  const viewer = await attach(streams);
  device.screens = [new DeviceUnreachableError()];

  await tick();

  expect(problems(viewer)).toEqual(["The Android device is unreachable"]);
  expect(viewer.ended).toBe(true);
  expect(await streams.input(input({ tap: { x: 1, y: 1 } }))).toEqual({ ok: false });
});

test("any other failure of a screenshot ends the stream with its words", async () => {
  const { streams, device, tick } = setup();
  const viewer = await attach(streams);
  device.screens = [new Error("adb broke")];

  await tick();

  expect(problems(viewer)).toEqual(["The Android view stopped: adb broke"]);
  expect(viewer.ended).toBe(true);
});

test("a viewer silent for 30 seconds is closed and its slot is freed", async () => {
  const { streams, clock, tick } = setup();
  const silent = await attach(streams);
  const speaking = await attach(streams);
  expect(SILENCE_LIMIT_MS).toBe(30_000);

  for (let elapsed = 0; elapsed < 20_000; elapsed += PICTURE_INTERVAL_MS) await tick();
  await streams.input(input({}, "stream-2"));
  clock.advance(0);
  for (let elapsed = 0; elapsed < 12_000; elapsed += PICTURE_INTERVAL_MS) await tick();

  expect(silent.ended).toBe(true);
  expect(speaking.ended).toBe(false);
  expect((await attach(streams)).events[0]?.type).toBe("ready");
});

test("unsubscribing frees the slot and stops the ticks", async () => {
  const { streams, clock, device } = setup();
  const first = await attach(streams);
  await attach(streams);

  first.controller.abort();
  await settle();

  expect(first.ended).toBe(true);
  expect((await attach(streams)).events[0]?.type).toBe("ready");
  clock.advance(PICTURE_INTERVAL_MS);
  await settle();
  expect(device.screenshots).toBe(2);
});

test("tap, swipe, key and text reach the device", async () => {
  const { streams, device } = setup();
  await attach(streams);

  await streams.input(input({ tap: { x: 10.4, y: 20.6 } }));
  await streams.input(
    input({ swipe: { from: { x: 1, y: 2 }, to: { x: 3, y: 4 }, durationMs: 300 } }),
  );
  for (const key of ["back", "home", "recents", "enter", "delete"] as const) {
    await streams.input(input({ key }));
  }
  await streams.input(input({ text: "hello world" }));

  expect(device.calls).toEqual([
    "tap 10 21",
    "swipe 1,2 3,4 300",
    "key KEYCODE_BACK",
    "key KEYCODE_HOME",
    "key KEYCODE_APP_SWITCH",
    "key KEYCODE_ENTER",
    "key KEYCODE_DEL",
    "text hello world",
  ]);
});

test("input for an unknown stream answers ok: false", async () => {
  const { streams, device } = setup();
  await attach(streams);

  expect(await streams.input(input({ tap: { x: 1, y: 1 } }, "nope"))).toEqual({ ok: false });
  expect(device.calls).toEqual([]);
});

test("a device that refuses an input leaves the stream open and says why", async () => {
  const { streams, device } = setup();
  const viewer = await attach(streams);
  device.failNext = new Error("no good");

  expect(await streams.input(input({ tap: { x: 1, y: 1 } }))).toEqual({
    ok: true,
    message: "no good",
  });
  expect(viewer.ended).toBe(false);
});

test("an input that finds the device unreachable ends the stream", async () => {
  const { streams, device } = setup();
  const viewer = await attach(streams);
  device.failNext = new DeviceUnreachableError();

  expect((await streams.input(input({ tap: { x: 1, y: 1 } }))).ok).toBe(false);
  await settle();

  expect(problems(viewer)).toEqual(["The Android device is unreachable"]);
});

test("stop() ends every stream and waits for them", async () => {
  const { streams, clock } = setup();
  const first = await attach(streams);
  const second = await attach(streams);

  await streams.stop();

  expect([first.ended, second.ended]).toEqual([true, true]);
  expect(clock.pending()).toBe(0);
});

test("a push that fails does not stop the stream or reject", async () => {
  const { streams, tick } = setup();
  const controller = new AbortController();
  let ended = false;
  void streams
    .attach({
      signal: controller.signal,
      push: async () => {
        throw new Error("link down");
      },
    })
    .then(() => {
      ended = true;
      return undefined;
    });
  await settle();

  await tick(2);

  expect(ended).toBe(false);
});
