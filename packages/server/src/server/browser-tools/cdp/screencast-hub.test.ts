import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  SCREENCAST_PARAMS,
  ScreencastHub,
  type ScreencastFrame,
  type ScreencastSource,
} from "./screencast-hub.js";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]).toString("base64");

/** A JPEG start and frame header of this pixel size; enough for the hub to read the size. */
function jpegOfSize(width: number, height: number): string {
  const header = [0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff];
  return Buffer.from([...header, width >> 8, width & 0xff, 0x03, ...Array(9).fill(0)]).toString(
    "base64",
  );
}

function fakeSource(options: { failStarts?: number } = {}) {
  let failStarts = options.failStarts ?? 0;
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const listeners = new Set<(params: Record<string, unknown>) => void>();
  const state = { screenshot: JPEG };
  const source: ScreencastSource = {
    send: async <T>(method: string, params: Record<string, unknown> = {}) => {
      calls.push({ method, params });
      if (method === "Page.startScreencast" && failStarts > 0) {
        failStarts -= 1;
        throw new Error("startScreencast failed");
      }
      if (method === "Page.captureScreenshot") return { data: state.screenshot } as T;
      if (method === "Page.getLayoutMetrics") {
        return {
          cssVisualViewport: { clientWidth: 390, clientHeight: 700, scale: 1, pageX: 0, pageY: 40 },
        } as T;
      }
      return {} as T;
    },
    on: (event, listener) => {
      if (event !== "Page.screencastFrame") return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const frame = (sessionId: number, scrollY = 0) => {
    for (const listener of listeners) {
      listener({
        data: JPEG,
        sessionId,
        metadata: {
          deviceWidth: 390,
          deviceHeight: 700,
          pageScaleFactor: 1,
          scrollOffsetX: 0,
          scrollOffsetY: scrollY,
        },
      });
    }
  };
  const count = (method: string) => calls.filter((call) => call.method === method).length;
  const acks = () =>
    calls
      .filter((call) => call.method === "Page.screencastFrameAck")
      .map((call) => call.params.sessionId);
  return {
    source,
    calls,
    frame,
    count,
    acks,
    listenerCount: () => listeners.size,
    set screenshot(data: string) {
      state.screenshot = data;
    },
  };
}

function viewer(id: string) {
  const frames: ScreencastFrame[] = [];
  return { id, frames, deliver: async (frame: ScreencastFrame) => void frames.push(frame) };
}

/** A viewer whose socket is backed up: each delivery waits until the test releases it. */
function slowViewer(id: string) {
  const release: Array<() => void> = [];
  const seen: number[] = [];
  const deliver = (frame: ScreencastFrame) =>
    new Promise<void>((resolve) => {
      seen.push(frame.sequence);
      release.push(resolve);
    });
  return { id, seen, release, deliver };
}

describe("ScreencastHub", () => {
  let fake: ReturnType<typeof fakeSource>;
  let hub: ScreencastHub;
  const flush = () => vi.advanceTimersByTimeAsync(0);

  beforeEach(() => {
    vi.useFakeTimers();
    fake = fakeSource();
    hub = new ScreencastHub({ source: async () => fake.source });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("starts on the first viewer and stops on the last", async () => {
    const stopA = await hub.watch("tab", viewer("a"));
    const stopB = await hub.watch("tab", viewer("b"));
    expect(fake.calls.filter((call) => call.method === "Page.startScreencast")).toEqual([
      { method: "Page.startScreencast", params: SCREENCAST_PARAMS },
    ]);
    stopA();
    expect(fake.count("Page.stopScreencast")).toBe(0);
    stopB();
    await flush();
    expect(fake.count("Page.stopScreencast")).toBe(1);
    expect(fake.listenerCount()).toBe(0);
    expect(hub.viewerCount("tab")).toBe(0);
  });

  test("fans each frame out with its metadata and a rising sequence", async () => {
    const a = viewer("a");
    const b = viewer("b");
    await hub.watch("tab", a);
    await hub.watch("tab", b);
    await flush();
    // Sequence 1 is the screenshot that primes a tab with no frame yet.
    expect(a.frames.map((frame) => frame.sequence)).toEqual([1]);
    fake.frame(1, 10);
    fake.frame(2, 20);
    await flush();
    expect(a.frames.slice(1).map((frame) => [frame.sequence, frame.scrollY])).toEqual([
      [2, 10],
      [3, 20],
    ]);
    expect(b.frames).toEqual(a.frames);
    expect(a.frames[1]).toMatchObject({
      deviceWidth: 390,
      deviceHeight: 700,
      pageScaleFactor: 1,
      scrollX: 0,
    });
    expect(Buffer.from(a.frames[1].jpeg).toString("base64")).toBe(JPEG);
  });

  test("viewers, the cache and onFrame get the frame size as frameSize corrects it", async () => {
    const seen: Array<[string, number, number]> = [];
    const errors: unknown[] = [];
    let fails = false;
    const correcting = new ScreencastHub({
      source: async () => fake.source,
      onError: (error) => errors.push(error),
      frameSize: (browserId, size) => {
        if (fails) throw new Error("correction failed");
        return browserId === "tab" ? { width: size.width / 2, height: size.height / 2 } : size;
      },
      onFrame: (browserId, frame) =>
        void seen.push([browserId, frame.deviceWidth, frame.deviceHeight]),
    });
    const a = viewer("a");
    await correcting.watch("tab", a);
    await flush();
    fake.frame(1);
    await flush();
    expect(a.frames[1]).toMatchObject({ deviceWidth: 195, deviceHeight: 350, scrollX: 0 });
    expect(seen).toEqual([["tab", 195, 350]]);
    const late = viewer("late");
    await correcting.watch("tab", late);
    await flush();
    expect(late.frames[0]).toMatchObject({ deviceWidth: 195, deviceHeight: 350 });
    // A correction that throws is reported and leaves the size as Chromium reported it.
    fails = true;
    fake.frame(2);
    await vi.advanceTimersByTimeAsync(100);
    expect(a.frames.at(-1)).toMatchObject({ deviceWidth: 390, deviceHeight: 700 });
    expect(errors).toEqual([new Error("correction failed")]);
  });

  test("refresh captures the tab and sends it down the frame path, sized from the JPEG", async () => {
    const seen: Array<[number, number]> = [];
    const refreshing = new ScreencastHub({
      source: async () => fake.source,
      deviceScaleFactor: () => 2,
      onFrame: (_browserId, frame) => void seen.push([frame.deviceWidth, frame.deviceHeight]),
    });
    const a = viewer("a");
    await refreshing.watch("tab", a);
    await flush();
    fake.frame(1);
    await flush();
    // The page has a scrollbar: the layout viewport is 15 px narrower than the JPEG shows.
    fake.screenshot = jpegOfSize(860, 1350);
    await expect(refreshing.refresh("tab")).resolves.toBe(true);
    await flush();
    expect(fake.count("Page.captureScreenshot")).toBe(2);
    expect(
      a.frames.map((frame) => [frame.sequence, frame.deviceWidth, frame.deviceHeight]),
    ).toEqual([
      [1, 390, 700],
      [2, 390, 700],
      [3, 430, 675],
    ]);
    expect(seen).toEqual([
      [390, 700],
      [430, 675],
    ]);
    const late = viewer("late");
    await refreshing.watch("tab", late);
    await flush();
    expect(late.frames.map((frame) => frame.sequence)).toEqual([3]);
  });

  test("the priming screenshot takes its size from the JPEG when it can read one", async () => {
    fake.screenshot = jpegOfSize(860, 1350);
    const priming = new ScreencastHub({
      source: async () => fake.source,
      deviceScaleFactor: () => 2,
    });
    const a = viewer("a");
    await priming.watch("tab", a);
    await flush();
    expect(a.frames[0]).toMatchObject({ deviceWidth: 430, deviceHeight: 675, scrollY: 40 });
  });

  test("refresh does nothing for a tab no viewer watches; the last viewer leaving reports idle", async () => {
    const idle: string[] = [];
    const watching = new ScreencastHub({
      source: async () => fake.source,
      onIdle: (browserId) => void idle.push(browserId),
    });
    await expect(watching.refresh("tab")).resolves.toBe(false);
    const stopA = await watching.watch("tab", viewer("a"));
    const stopB = await watching.watch("tab", viewer("b"));
    await flush();
    stopA();
    expect(idle).toEqual([]);
    stopB();
    expect(idle).toEqual(["tab"]);
    const captures = fake.count("Page.captureScreenshot");
    await expect(watching.refresh("tab")).resolves.toBe(false);
    expect(fake.count("Page.captureScreenshot")).toBe(captures);
  });

  test("a later viewer gets the cached frame at once, with no second screenshot", async () => {
    await hub.watch("tab", viewer("a"));
    await flush();
    fake.frame(1);
    await flush();
    const late = viewer("late");
    await hub.watch("tab", late);
    await flush();
    expect(late.frames.map((frame) => frame.sequence)).toEqual([2]);
    expect(fake.count("Page.captureScreenshot")).toBe(1);
  });

  test("with nothing cached the first viewer gets one screenshot", async () => {
    const a = viewer("a");
    await hub.watch("tab", a);
    await flush();
    expect(fake.calls.find((call) => call.method === "Page.captureScreenshot")?.params).toEqual({
      format: "jpeg",
      quality: 60,
    });
    expect(a.frames).toHaveLength(1);
    expect(a.frames[0]).toMatchObject({ deviceWidth: 390, deviceHeight: 700, scrollY: 40 });
  });

  test("a backed-up viewer keeps only the newest frame", async () => {
    const slow = slowViewer("slow");
    const fast = viewer("fast");
    await hub.watch("tab", fast);
    await flush();
    await hub.watch("tab", slow);
    await flush();
    expect(slow.seen).toEqual([1]);
    // Chromium sends each frame in its own socket message, so a fast viewer finishes in between.
    fake.frame(1);
    await flush();
    fake.frame(2);
    await flush();
    fake.frame(3);
    await flush();
    expect(slow.seen).toEqual([1]);
    slow.release.shift()?.();
    await flush();
    expect(slow.seen).toEqual([1, 4]);
    expect(fast.frames.map((frame) => frame.sequence)).toEqual([1, 2, 3, 4]);
  });

  test("acks are at least 100 ms apart, which caps the stream at 10 frames per second", async () => {
    await hub.watch("tab", viewer("a"));
    fake.frame(1);
    await flush();
    expect(fake.acks()).toEqual([1]);
    await vi.advanceTimersByTimeAsync(10);
    fake.frame(2);
    await vi.advanceTimersByTimeAsync(80);
    expect(fake.acks()).toEqual([1]);
    await vi.advanceTimersByTimeAsync(10);
    expect(fake.acks()).toEqual([1, 2]);
  });

  test("a viewer whose delivery fails is removed", async () => {
    const broken = {
      id: "broken",
      deliver: async () => {
        throw new Error("socket closed");
      },
    };
    await hub.watch("tab", broken);
    await flush();
    expect(hub.viewerCount("tab")).toBe(0);
    expect(fake.count("Page.stopScreencast")).toBe(1);
  });

  test("a viewer that throws at once does not stop frames for the others", async () => {
    const errors: unknown[] = [];
    const guarded = new ScreencastHub({
      source: async () => fake.source,
      onError: (error) => errors.push(error),
    });
    const good = viewer("good");
    await guarded.watch("tab", good);
    await guarded.watch("tab", {
      id: "throws",
      deliver: () => {
        throw new Error("sync failure");
      },
    });
    await flush();
    fake.frame(1);
    await flush();
    expect(good.frames.map((frame) => frame.sequence)).toEqual([1, 2]);
    expect(guarded.viewerCount("tab")).toBe(1);
    expect(errors).toEqual([new Error("sync failure")]);
  });

  test("rebind moves the viewers to the tab's new socket", async () => {
    let current = fake;
    const swapping = new ScreencastHub({ source: async () => current.source });
    const a = viewer("a");
    await swapping.watch("tab", a);
    await flush();
    fake.frame(1);
    await flush();
    const next = fakeSource();
    current = next;
    await swapping.rebind("tab");
    expect(fake.listenerCount()).toBe(0);
    expect(next.count("Page.startScreencast")).toBe(1);
    await vi.advanceTimersByTimeAsync(200);
    next.frame(7);
    await flush();
    expect(a.frames.map((frame) => frame.sequence)).toEqual([1, 2, 3]);
  });

  test("watch rejects when the tab has no source", async () => {
    const empty = new ScreencastHub({ source: async () => null });
    await expect(empty.watch("gone", viewer("a"))).rejects.toThrow("browser_tab_not_found");
  });

  test("a failed start leaves no listener behind, and the next watch starts again", async () => {
    const failing = fakeSource({ failStarts: 1 });
    const flaky = new ScreencastHub({ source: async () => failing.source });
    await expect(flaky.watch("tab", viewer("a"))).rejects.toThrow("startScreencast failed");
    expect(failing.listenerCount()).toBe(0);
    expect(flaky.viewerCount("tab")).toBe(0);
    await flaky.watch("tab", viewer("b"));
    expect(failing.count("Page.startScreencast")).toBe(2);
    expect(failing.listenerCount()).toBe(1);
    expect(flaky.viewerCount("tab")).toBe(1);
  });

  test("drop forgets the tab without talking to its socket", async () => {
    await hub.watch("tab", viewer("a"));
    hub.drop("tab");
    await flush();
    expect(hub.viewerCount("tab")).toBe(0);
    expect(fake.count("Page.stopScreencast")).toBe(0);
  });
});
