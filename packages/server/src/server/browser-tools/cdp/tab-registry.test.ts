import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { CdpTabRegistry, type CdpTabEntry } from "./tab-registry.js";

const entry = (overrides: Partial<CdpTabEntry> = {}): CdpTabEntry => ({
  browserId: "11111111-1111-4111-8111-111111111111",
  targetId: "T1",
  workspaceId: "ws-a",
  lastUrl: "https://example.com/",
  createdAt: 1,
  ...overrides,
});

describe("CdpTabRegistry", () => {
  let dir: string;
  let file: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "paseo-cdp-tabs-"));
    file = path.join(dir, "browser-tools", "cdp-tabs.json");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("persists entries and loads them back", async () => {
    const registry = new CdpTabRegistry(file);
    await registry.load();
    registry.add(entry());
    registry.setLastUrl(entry().browserId, "https://example.com/next");
    await registry.flush();

    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({
      version: 1,
      tabs: [entry({ lastUrl: "https://example.com/next" })],
    });
    const reloaded = new CdpTabRegistry(file);
    await reloaded.load();
    expect(reloaded.list()).toEqual([entry({ lastUrl: "https://example.com/next" })]);
    expect(reloaded.findByTarget("T1")?.browserId).toBe(entry().browserId);
  });

  test("a missing or corrupt file loads as empty", async () => {
    const missing = new CdpTabRegistry(file);
    await missing.load();
    expect(missing.list()).toEqual([]);

    const errors: unknown[] = [];
    const corruptFile = path.join(dir, "corrupt.json");
    await writeFile(corruptFile, "{not json");
    const corrupt = new CdpTabRegistry(corruptFile, (error) => errors.push(error));
    await corrupt.load();
    expect(corrupt.list()).toEqual([]);
    expect(errors).toHaveLength(1);
  });

  test("reconcile drops entries whose target is gone and returns them", async () => {
    const registry = new CdpTabRegistry(file);
    await registry.load();
    const kept = entry();
    const gone = entry({ browserId: "22222222-2222-4222-8222-222222222222", targetId: "T2" });
    registry.add(kept);
    registry.add(gone);
    expect(registry.reconcile(new Set(["T1", "OTHER"]))).toEqual([gone]);
    expect(registry.list()).toEqual([kept]);
    await registry.flush();
  });

  test("a popup joins its opener's workspace; a stranger's popup is ignored", async () => {
    const registry = new CdpTabRegistry(file);
    await registry.load();
    registry.add(entry());
    const popupId = "33333333-3333-4333-8333-333333333333";
    expect(
      registry.adoptPopup({
        targetId: "P1",
        openerId: "T1",
        url: "https://example.com/popup",
        browserId: popupId,
        now: 5,
      }),
    ).toEqual({
      browserId: popupId,
      targetId: "P1",
      workspaceId: "ws-a",
      lastUrl: "https://example.com/popup",
      createdAt: 5,
    });
    expect(
      registry.adoptPopup({
        targetId: "P2",
        openerId: "UNKNOWN",
        url: "about:blank",
        browserId: popupId,
        now: 6,
      }),
    ).toBeNull();
    // The same target is never adopted twice.
    expect(
      registry.adoptPopup({
        targetId: "P1",
        openerId: "T1",
        url: "about:blank",
        browserId: "44444444-4444-4444-8444-444444444444",
        now: 7,
      }),
    ).toBeNull();
    expect(registry.list()).toHaveLength(2);
    await registry.flush();
  });

  test("remove returns the entry once", async () => {
    const registry = new CdpTabRegistry(file);
    await registry.load();
    registry.add(entry());
    expect(registry.remove(entry().browserId)).toEqual(entry());
    expect(registry.remove(entry().browserId)).toBeNull();
    expect(registry.get(entry().browserId)).toBeNull();
    await registry.flush();
  });
});
