import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { bundleBrowserScript } from "../../../packages/server/src/server/plugins/browser-script.js";

const SHEET_PAGE = fileURLToPath(new URL("./sheet-page.ts", import.meta.url));

test("the sheet page script carries the scene, not the wire contracts and their schema library", async () => {
  const script = await bundleBrowserScript(SHEET_PAGE);

  // contracts.ts would bring zod with it, six times the size of the scene itself.
  expect(script).not.toContain("office.world.request");
  expect(script.length).toBeLessThan(150_000);
  expect(script).toContain("__officeSheet");
}, 30_000);
