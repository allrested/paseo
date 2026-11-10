import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginSettings, PluginSettingsState } from "@getpaseo/plugin/server";
import { afterEach, describe, expect, it } from "vitest";
import type { SkillEntry } from "../shared/catalog.js";
import type { defaultSkillsSettings } from "../shared/settings.js";
import { skillPaths } from "./paths.js";
import { startDefaultSkills } from "./plugin.js";

type Schema = (typeof defaultSkillsSettings)["schema"];
type State = PluginSettingsState<Schema>;

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const UB: SkillEntry = {
  id: "ub-mode",
  label: "",
  summary: "",
  folders: ["ub-mode"],
  defaultOn: true,
};

function ready(values: Partial<Record<string, boolean>>): State {
  return {
    status: "ready",
    revision: "r",
    values: {
      "ub-mode": true,
      "ai-design-skills": true,
      "anti-slop": true,
      "ui-ux-pro-max": true,
      ...values,
    },
  };
}

interface FakeSettings {
  settings: PluginSettings<Schema>;
  save(state: State): void;
  listeners(): number;
}

function fakeSettings(read: () => Promise<State>): FakeSettings {
  const listeners = new Set<(state: State) => void>();
  return {
    settings: {
      read,
      subscribe(listener) {
        const wrapped = (state: State) => void listener(state);
        listeners.add(wrapped);
        return () => listeners.delete(wrapped);
      },
    },
    save(state) {
      for (const listener of listeners) listener(state);
    },
    listeners: () => listeners.size,
  };
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "default-skills-plugin-"));
  roots.push(root);
  const home = join(root, "home");
  const paths = skillPaths({ PASEO_HOME: join(root, "paseo-home") }, home);
  const vendor = join(root, "vendor");
  await mkdir(join(vendor, "ub-mode", "ub-mode"), { recursive: true });
  await writeFile(join(vendor, "ub-mode", "ub-mode", "SKILL.md"), "# ub-mode\n");
  return { paths, vendor };
}

describe("startDefaultSkills", () => {
  it("syncs the stored switches at start", async () => {
    const { paths, vendor } = await setup();
    const fake = fakeSettings(async () => ready({}));
    const logs: string[] = [];

    const plugin = startDefaultSkills({
      settings: fake.settings,
      paths,
      vendorDirectory: vendor,
      skills: [UB],
      log: (message) => logs.push(message),
    });

    const status = await plugin.status();
    expect(status).toEqual({
      status: "done",
      skillsDirectory: paths.skillsDirectory,
      skills: [{ id: "ub-mode", folders: [{ folder: "ub-mode", state: "installed" }] }],
      recordError: null,
    });
    expect(await readdir(paths.skillsDirectory)).toEqual(["ub-mode"]);
    expect(logs).toEqual([]);
    await plugin.stop();
    expect(fake.listeners()).toBe(0);
  });

  it("syncs again when a save switches a skill off", async () => {
    const { paths, vendor } = await setup();
    const fake = fakeSettings(async () => ready({}));
    const plugin = startDefaultSkills({
      settings: fake.settings,
      paths,
      vendorDirectory: vendor,
      skills: [UB],
      log: () => {},
    });
    await plugin.status();

    fake.save(ready({ "ub-mode": false }));

    const status = await plugin.status();
    expect(status.status === "done" && status.skills[0]?.folders).toEqual([
      { folder: "ub-mode", state: "off" },
    ]);
    expect(await readdir(paths.skillsDirectory)).toEqual([]);
    await plugin.stop();
  });

  it("keeps the skills as they are when the saved settings are invalid", async () => {
    const { paths, vendor } = await setup();
    const fake = fakeSettings(async () => ({ status: "invalid", revision: "r", error: "bad" }));
    const logs: string[] = [];

    const plugin = startDefaultSkills({
      settings: fake.settings,
      paths,
      vendorDirectory: vendor,
      skills: [UB],
      log: (message) => logs.push(message),
    });

    expect(await plugin.status()).toEqual({ status: "pending" });
    expect(logs).toEqual([
      "default-skills: settings are invalid, the skills stay as they are: bad",
    ]);
    await plugin.stop();
  });

  it("reports a failed settings read without throwing", async () => {
    const { paths, vendor } = await setup();
    const fake = fakeSettings(() => Promise.reject(new Error("store gone")));
    const logs: string[] = [];

    const plugin = startDefaultSkills({
      settings: fake.settings,
      paths,
      vendorDirectory: vendor,
      skills: [UB],
      log: (message) => logs.push(message),
    });

    expect(await plugin.status()).toEqual({
      status: "failed",
      error: "Reading the settings failed: store gone",
    });
    expect(logs).toEqual(["default-skills: Reading the settings failed: store gone"]);
    await plugin.stop();
  });

  it("installs nothing when the daemon did not pass the plugin's directory", async () => {
    const { paths } = await setup();
    const fake = fakeSettings(async () => ready({}));
    const logs: string[] = [];

    const plugin = startDefaultSkills({
      settings: fake.settings,
      paths,
      vendorDirectory: null,
      skills: [UB],
      log: (message) => logs.push(message),
    });

    expect(await plugin.status()).toEqual({
      status: "failed",
      error: "The daemon did not pass the plugin's directory",
    });
    expect(logs).toEqual([
      "default-skills: sync failed: The daemon did not pass the plugin's directory",
    ]);
    await plugin.stop();
  });

  it("runs no sync for a save that arrives after stop", async () => {
    const { paths, vendor } = await setup();
    const fake = fakeSettings(async () => ready({ "ub-mode": false }));
    const plugin = startDefaultSkills({
      settings: fake.settings,
      paths,
      vendorDirectory: vendor,
      skills: [UB],
      log: () => {},
    });
    await plugin.stop();

    fake.save(ready({ "ub-mode": true }));

    expect(fake.listeners()).toBe(0);
    expect(await readdir(paths.skillsDirectory).catch(() => [])).toEqual([]);
  });
});
