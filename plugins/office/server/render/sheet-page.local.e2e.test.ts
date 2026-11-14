// Hand-run only: set PASEO_TEST_CDP_URL to a Chromium's CDP address with WebGL on (see
// docs/docker.md). It opens its own window on about:blank and closes it; it visits no site.
//
// The fidelity check of the sheet view: the pictures the app lays over each other must add up to
// the office the scene draws. It saves both and their difference to the temp directory.
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
import { readThreeAsset } from "../asset.js";
import { scriptedPages, type PagePort } from "./page-host.js";
import { PREVIEW_GLOBAL, type PreviewResult } from "./sheet-preview.fixture.js";

const CDP_URL = process.env.PASEO_TEST_CDP_URL;
const OFFICE_DIR = fileURLToPath(new URL("../../", import.meta.url));
const logger = { debug: () => {}, warn: console.warn };
/** A phone held upright. */
const SIZE = { width: 390, height: 700, pixelRatio: 2.625 };

describe.skipIf(!CDP_URL)("sheet page against a real Chromium", () => {
  let pages: CdpOffscreenPages;
  let page: PagePort;

  beforeAll(async () => {
    pages = new CdpOffscreenPages({ endpoint: new CdpEndpoint({ url: CDP_URL! }), logger });
    const open = scriptedPages({
      pages,
      bundle: bundleBrowserScript,
      readThree: () => readThreeAsset(path.join(OFFICE_DIR, "vendor")),
      pageEntry: path.join(OFFICE_DIR, "render", "sheet-page.ts"),
    });
    page = await open({ width: 64, height: 64, deviceScaleFactor: 1 });
    await page.evaluate(
      await bundleBrowserScript(
        path.join(OFFICE_DIR, "server", "render", "sheet-preview.fixture.ts"),
      ),
    );
  }, 60_000);

  afterAll(async () => {
    await pages?.stop();
  });

  test("the pictures add up to the office the scene draws", async () => {
    const input = {
      colors: LIGHT_THEME_COLORS,
      size: SIZE,
      event: { type: "snapshot", state: fakeOffice() },
    };
    const started = Date.now();
    const result = await page.evaluate<PreviewResult>(
      `globalThis[${JSON.stringify(PREVIEW_GLOBAL)}].run(${JSON.stringify(input)})`,
    );
    const took = Date.now() - started;
    const out = os.tmpdir();
    for (const name of ["composed", "reference", "difference"] as const) {
      await writeFile(
        path.join(out, `office-sheet-${name}.png`),
        Buffer.from(result[name], "base64"),
      );
    }
    const share = result.differing / result.pixels;
    const numbers = {
      took,
      picture: [result.sheet.width, result.sheet.height],
      ratio: result.sheet.ratio,
      scale: result.sheet.scale,
      frame: result.sheet.frame,
      robots: result.sheet.robots.length,
      tiles: result.tiles,
      tileBytes: result.tileBytes,
      sprites: result.sprites,
      differing: result.differing,
      share,
    };
    await writeFile(path.join(out, "office-sheet-numbers.json"), JSON.stringify(numbers, null, 1));
    expect(result.sheet.robots.length).toBeGreaterThan(20);
    // Soft edges laid half a pixel off, and JPEG: a thin share of the picture.
    expect(share).toBeLessThan(0.01);
  }, 120_000);
});
