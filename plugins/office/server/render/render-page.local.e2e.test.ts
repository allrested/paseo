// Hand-run only: set PASEO_TEST_CDP_URL to a Chromium's CDP address with WebGL on (see
// docs/docker.md). It opens its own windows on about:blank and closes them; it visits no site.
import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { CdpEndpoint } from "../../../../packages/server/src/server/browser-tools/cdp/cdp-endpoint.js";
import { CdpOffscreenPages } from "../../../../packages/server/src/server/browser-tools/cdp/offscreen-pages.js";
import { bundleBrowserScript } from "../../../../packages/server/src/server/plugins/browser-script.js";
import { fakeOffice } from "../../client/scene/fake-office.js";
import { LIGHT_THEME_COLORS } from "../../client/scene/fake-theme.js";
import type { RenderEvent } from "../../shared/contracts.js";
import type { RenderTake } from "../../shared/render.js";
import { readThreeAsset } from "../asset.js";
import { nodeClock } from "../timers.js";
import { createRenderPageHost, type RenderPage, type RenderPageHost } from "./page-host.js";
import { createRenderSessions } from "./sessions.js";

const CDP_URL = process.env.PASEO_TEST_CDP_URL;
const OFFICE_DIR = fileURLToPath(new URL("../../", import.meta.url));
const VIEWPORT = { width: 390, height: 700, deviceScaleFactor: 1.8 };
const logger = { debug: () => {}, warn: console.warn };

async function takeUntil(
  page: RenderPage,
  wanted: (take: RenderTake) => boolean,
  label: string,
): Promise<RenderTake> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const take = await page.take();
    if (wanted(take)) return take;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 125));
  }
}

/** Takes pictures until none came for a second: the scene has stopped drawing. */
async function settle(page: RenderPage): Promise<void> {
  let quietSince = Date.now();
  const deadline = Date.now() + 20_000;
  while (Date.now() - quietSince < 1000) {
    if ((await page.take()).picture !== null) quietSince = Date.now();
    if (Date.now() > deadline) throw new Error("The scene never stopped drawing");
    await new Promise((resolve) => setTimeout(resolve, 125));
  }
}

describe.skipIf(!CDP_URL)("render page against a real Chromium", () => {
  let pages: CdpOffscreenPages;
  let host: RenderPageHost;
  let page: RenderPage;

  beforeAll(async () => {
    pages = new CdpOffscreenPages({ endpoint: new CdpEndpoint({ url: CDP_URL! }), logger });
    host = createRenderPageHost({
      pages,
      bundle: bundleBrowserScript,
      readThree: () => readThreeAsset(path.join(OFFICE_DIR, "vendor")),
      pageEntry: path.join(OFFICE_DIR, "render", "page.ts"),
    });
    page = await host.open({
      viewport: VIEWPORT,
      colors: LIGHT_THEME_COLORS,
      coarsePointer: true,
    });
  }, 60_000);

  afterAll(async () => {
    await pages?.stop();
  });

  test("draws the fake office and returns a JPEG of the viewport", async () => {
    // No agent is running in this office, so the scene comes to rest.
    const still = fakeOffice();
    for (const agent of still.agents) if (agent.status === "running") agent.status = "idle";
    await page.state({ type: "snapshot", state: still });

    const take = await takeUntil(page, (next) => next.picture !== null, "the first picture");

    // The scene draws a touch view at 1.5 device pixels at most (pixelRatioFor): 390 x 700 at 1.5.
    expect(take.picture?.width).toBe(585);
    expect(take.picture?.height).toBe(1050);
    await settle(page);
    await page.focus({ agentId: "Review MR" });
    const focused = await takeUntil(page, (next) => next.picture !== null, "the focused picture");
    await settle(page);
    const last = (await page.take()).picture ?? focused.picture!;
    const bytes = Buffer.from(last.jpeg, "base64");
    expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    await writeFile(path.join(os.tmpdir(), "office-render.jpg"), bytes);
  }, 90_000);

  test("a press and release on a robot reports that agent", async () => {
    // The camera is on "Review MR": its robot is at the middle of the view, or just beside it.
    const middle = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    const offsets = [0, -12, 12, -24, 24, -36, 36];
    let found: RenderTake | null = null;
    search: for (const dy of offsets) {
      for (const dx of offsets) {
        const at = { x: middle.x + dx, y: middle.y + dy };
        await page.pointer([
          { type: "down", ...at },
          { type: "up", ...at },
        ]);
        const take = await page.take();
        if (take.events.some((event) => event.type === "agent")) {
          found = take;
          break search;
        }
      }
    }

    expect(found?.events).toContainEqual({ type: "agent", agentId: "Review MR" });
  }, 60_000);

  test("a cancelled press picks nothing", async () => {
    const middle = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };

    await page.pointer([
      { type: "down", ...middle },
      { type: "cancel", ...middle },
    ]);
    await settle(page);

    expect((await page.take()).events).toEqual([]);
  }, 60_000);

  test("a still office gives no second picture", async () => {
    await settle(page);

    for (let index = 0; index < 8; index++) {
      expect((await page.take()).picture).toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 125));
    }
  }, 60_000);

  test("a drag pans: the picture changes", async () => {
    await settle(page);

    await page.pointer([
      { type: "down", x: 200, y: 400 },
      { type: "move", x: 200, y: 360 },
      { type: "move", x: 200, y: 300 },
      { type: "up", x: 200, y: 300 },
    ]);

    const take = await takeUntil(page, (next) => next.picture !== null, "the panned picture");
    expect(take.events).toEqual([]);
    await writeFile(
      path.join(os.tmpdir(), "office-render-panned.jpg"),
      Buffer.from(take.picture!.jpeg, "base64"),
    );
  }, 60_000);

  test("a session gives its viewer ready, then a picture, and closes its page when the viewer leaves", async () => {
    const sessions = createRenderSessions({
      host,
      hub: {
        attach: async (subscriber) => {
          await subscriber.push({ type: "snapshot", state: fakeOffice() });
          await new Promise<void>((resolve) =>
            subscriber.signal.addEventListener("abort", () => resolve(), { once: true }),
          );
        },
      },
      clock: nodeClock,
      newStreamId: () => "stream-e2e",
      log: console.warn,
    });
    const events: RenderEvent[] = [];
    const viewer = new AbortController();
    const done = sessions.attach(
      {
        width: 390.4,
        height: 699.6,
        pixelRatio: 3,
        colors: LIGHT_THEME_COLORS,
        coarsePointer: true,
      },
      { signal: viewer.signal, push: async (event) => void events.push(event) },
    );
    const deadline = Date.now() + 20_000;
    while (!events.some((event) => event.type === "picture")) {
      if (Date.now() > deadline) throw new Error("No picture reached the viewer");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    expect(events[0]).toEqual({ type: "ready", streamId: "stream-e2e" });
    expect(events.find((event) => event.type === "picture")).toMatchObject({ seq: 1, width: 585 });
    expect(await sessions.input({ streamId: "stream-e2e", shown: 1 })).toEqual({ ok: true });
    viewer.abort();
    await done;
    expect(await sessions.input({ streamId: "stream-e2e" })).toEqual({ ok: false });
  }, 60_000);
});
