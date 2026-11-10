import type { PluginSettings, PluginSettingsState } from "@getpaseo/plugin/server";
import { SKILLS, type SkillEntry } from "../shared/catalog.js";
import type { SyncStatus } from "../shared/rpc.js";
import type { defaultSkillsSettings } from "../shared/settings.js";
import type { SkillPaths } from "./paths.js";
import { syncSkills } from "./sync.js";

type Schema = (typeof defaultSkillsSettings)["schema"];

export interface DefaultSkillsOptions {
  settings: PluginSettings<Schema>;
  paths: SkillPaths;
  /** `vendor/` in the plugin directory; null when the daemon did not say where the plugin is. */
  vendorDirectory: string | null;
  skills?: readonly SkillEntry[];
  log(message: string): void;
}

export interface DefaultSkills {
  /** The newest sync's result, after every sync queued so far has run. */
  status(): Promise<SyncStatus>;
  stop(): Promise<void>;
}

/** Syncs once at start and again on every settings save. Nothing else runs in between. */
export function startDefaultSkills(options: DefaultSkillsOptions): DefaultSkills {
  const { settings, paths, vendorDirectory, log } = options;
  const skills = options.skills ?? SKILLS;
  let last: SyncStatus = { status: "pending" };
  let queue: Promise<void> = Promise.resolve();
  let superseded = false;
  let stopped = false;

  function enqueue(state: PluginSettingsState<Schema>): void {
    if (state.status === "invalid") {
      log(`default-skills: settings are invalid, the skills stay as they are: ${state.error}`);
      return;
    }
    const switches: Record<string, boolean> = state.values;
    queue = queue.then(() => runSync(switches));
  }

  async function runSync(switches: Record<string, boolean>): Promise<void> {
    if (stopped) return;
    last =
      vendorDirectory === null
        ? { status: "failed", error: "The daemon did not pass the plugin's directory" }
        : await syncSkills({ ...paths, vendorDirectory, skills, switches });
    report(last, log);
  }

  // subscribe() never replays the stored value: read() supplies it unless a save arrived first.
  const unsubscribe = settings.subscribe((state) => {
    superseded = true;
    enqueue(state);
  });
  async function readStored(): Promise<void> {
    try {
      const state = await settings.read();
      if (!superseded) enqueue(state);
    } catch (error) {
      const message = `Reading the settings failed: ${describeError(error)}`;
      last = { status: "failed", error: message };
      log(`default-skills: ${message}`);
    }
  }
  queue = readStored();

  // A step can queue the next one (the first read does), so wait until the queue stops growing.
  // It never rejects: every step catches its own errors.
  async function settle(): Promise<void> {
    let current: Promise<void>;
    do {
      current = queue;
      await current;
    } while (current !== queue);
  }

  return {
    async status() {
      await settle();
      return last;
    },
    async stop() {
      stopped = true;
      unsubscribe();
      await settle();
    },
  };
}

function report(status: SyncStatus, log: (message: string) => void): void {
  if (status.status === "failed") {
    log(`default-skills: sync failed: ${status.error}`);
    return;
  }
  if (status.status !== "done") return;
  for (const skill of status.skills) {
    for (const folder of skill.folders) {
      if (folder.state === "error") log(`default-skills: ${folder.folder}: ${folder.error}`);
    }
  }
  if (status.recordError) log(`default-skills: ${status.recordError}`);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
