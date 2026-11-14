import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { bundleBrowserScript } from "../../../packages/server/src/server/plugins/browser-script.js";

const PAGE = fileURLToPath(new URL("./page.ts", import.meta.url));
const SHEET_PAGE = fileURLToPath(new URL("./sheet-page.ts", import.meta.url));

test("the page script carries the scene, not the wire contracts and their schema library", async () => {
  const script = await bundleBrowserScript(PAGE);

  // contracts.ts would bring zod with it, six times the size of the scene itself.
  expect(script).not.toContain("office.asset.request");
  expect(script.length).toBeLessThan(150_000);
  expect(script).toContain("__officeRender");
}, 30_000);

test("the sheet page script carries the scene, not the wire contracts and their schema library", async () => {
  const script = await bundleBrowserScript(SHEET_PAGE);

  expect(script).not.toContain("office.asset.request");
  expect(script.length).toBeLessThan(150_000);
  expect(script).toContain("__officeSheet");
}, 30_000);
