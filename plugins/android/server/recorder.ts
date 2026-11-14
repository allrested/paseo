// One screen recording at a time on the stack's device, for the agent tools.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { AndroidDevice } from "./device.js";
import { errorMessage } from "./errors.js";

/** Android's screenrecord stops on its own after 3 minutes. */
export const RECORD_LIMIT_S = 180;

export interface ScreenRecorder {
  start(): Promise<{ ok: true } | { ok: false; error: string }>;
  /** Stops the recording (unless it already stopped) and saves it under `<dir>/.paseo/android/`. */
  stop(dir: string): Promise<{ ok: true; path: string } | { ok: false; error: string }>;
}

interface Recording {
  remote: string;
  startedAt: Date;
  done: Promise<void>;
  ended: boolean;
  error: string | null;
}

export function createScreenRecorder(deps: {
  device: Pick<AndroidDevice, "record" | "shell" | "pull">;
  now(): Date;
}): ScreenRecorder {
  const { device } = deps;
  let recording: Recording | null = null;

  return {
    async start() {
      if (recording && !recording.ended)
        return { ok: false, error: "A recording is already running" };
      const startedAt = deps.now();
      const remote = `/sdcard/paseo-recording-${startedAt.getTime()}.mp4`;
      const { done } = await device.record(remote, RECORD_LIMIT_S);
      const current: Recording = { remote, startedAt, done, ended: false, error: null };
      recording = current;
      void (async () => {
        try {
          await done;
        } catch (error) {
          current.error = errorMessage(error);
        } finally {
          current.ended = true;
        }
      })();
      return { ok: true };
    },
    async stop(dir) {
      const current = recording;
      if (current === null) {
        return { ok: false, error: "No recording to save: call android_record_start first" };
      }
      if (!current.ended) {
        // SIGINT lets screenrecord finish the MP4; a kill would leave it unplayable.
        await device.shell(["pkill", "-INT", "screenrecord"]);
        await current.done.catch(() => undefined);
      }
      recording = null;
      if (current.error !== null)
        return { ok: false, error: `The recording failed: ${current.error}` };
      const folder = join(dir, ".paseo", "android");
      await mkdir(folder, { recursive: true });
      const name = `recording-${current.startedAt.toISOString().replace(/[:.]/g, "-")}.mp4`;
      const path = join(folder, name);
      await device.pull(current.remote, path);
      await device.shell(["rm", "-f", current.remote]);
      return { ok: true, path };
    },
  };
}
