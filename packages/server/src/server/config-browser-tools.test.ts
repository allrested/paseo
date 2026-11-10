import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { loadConfig } from "./config.js";

const roots: string[] = [];

async function createPaseoHome(config: unknown): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "paseo-config-browser-tools-"));
  roots.push(root);
  const paseoHome = path.join(root, ".paseo");
  await mkdir(paseoHome, { recursive: true });
  await writeFile(path.join(paseoHome, "config.json"), JSON.stringify(config, null, 2));
  return paseoHome;
}

describe("daemon browser tools config", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  test("defaults browser tools off when config is absent", async () => {
    const home = await createPaseoHome({ version: 1 });

    expect(loadConfig(home, { env: {} }).browserToolsEnabled).toBe(false);
  });

  test("loads browser tools opt-in from persisted daemon config", async () => {
    const home = await createPaseoHome({
      version: 1,
      daemon: { browserTools: { enabled: true } },
    });

    expect(loadConfig(home, { env: {} }).browserToolsEnabled).toBe(true);
  });

  test("PASEO_BROWSER_TOOLS_ENABLED is the default when nothing is persisted", async () => {
    const home = await createPaseoHome({ version: 1 });

    expect(
      loadConfig(home, { env: { PASEO_BROWSER_TOOLS_ENABLED: "true" } }).browserToolsEnabled,
    ).toBe(true);
  });

  test("the persisted setting wins over PASEO_BROWSER_TOOLS_ENABLED", async () => {
    const home = await createPaseoHome({
      version: 1,
      daemon: { browserTools: { enabled: false } },
    });

    expect(
      loadConfig(home, { env: { PASEO_BROWSER_TOOLS_ENABLED: "true" } }).browserToolsEnabled,
    ).toBe(false);
  });

  test("reads the CDP URL from PASEO_BROWSER_CDP_URL", async () => {
    const home = await createPaseoHome({ version: 1 });

    expect(loadConfig(home, { env: {} }).browserCdpUrl).toBeUndefined();
    expect(
      loadConfig(home, { env: { PASEO_BROWSER_CDP_URL: "  " } }).browserCdpUrl,
    ).toBeUndefined();
    expect(
      loadConfig(home, { env: { PASEO_BROWSER_CDP_URL: "http://127.0.0.1:9222" } }).browserCdpUrl,
    ).toBe("http://127.0.0.1:9222");
  });
});
