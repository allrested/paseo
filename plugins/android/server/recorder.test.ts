import { mkdtemp, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { AndroidDevice } from "./device.js";
import { createScreenRecorder, RECORD_LIMIT_S } from "./recorder.js";

const NOW = new Date("2026-11-14T05:06:07.890Z");

function fakeDevice() {
  const calls: string[] = [];
  let ends: { resolve(): void; reject(error: Error): void } | null = null;
  const finish = (error?: Error) => (error ? ends?.reject(error) : ends?.resolve());
  const device = {
    record: async (remote: string, seconds: number) => {
      calls.push(`record ${remote} ${seconds}`);
      const done = new Promise<void>((resolve, reject) => {
        ends = { resolve, reject };
      });
      return { done };
    },
    shell: async (command: readonly string[]) => {
      calls.push(`shell ${command.join(" ")}`);
      if (command[0] === "pkill") finish();
      return "";
    },
    pull: async (remote: string, local: string) => {
      calls.push(`pull ${remote}`);
      await import("node:fs/promises").then((fs) => fs.writeFile(local, "mp4"));
    },
  } as unknown as AndroidDevice;
  return { device, calls, end: (error?: Error) => finish(error) };
}

async function workspace(): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), "android-rec-")));
}

describe("screen recorder", () => {
  test("records until stopped, then saves the video in the workspace and removes it from the device", async () => {
    const { device, calls } = fakeDevice();
    const recorder = createScreenRecorder({ device, now: () => NOW });
    expect(await recorder.start()).toEqual({ ok: true });
    const dir = await workspace();
    const saved = await recorder.stop(dir);
    const path = join(dir, ".paseo", "android", "recording-2026-11-14T05-06-07-890Z.mp4");
    expect(saved).toEqual({ ok: true, path });
    expect(await readFile(path, "utf8")).toBe("mp4");
    const remote = `/sdcard/paseo-recording-${NOW.getTime()}.mp4`;
    expect(calls).toEqual([
      `record ${remote} ${RECORD_LIMIT_S}`,
      "shell pkill -INT screenrecord",
      `pull ${remote}`,
      `shell rm -f ${remote}`,
    ]);
  });

  test("one recording at a time, and stop without one says so", async () => {
    const { device } = fakeDevice();
    const recorder = createScreenRecorder({ device, now: () => NOW });
    expect(await recorder.stop(await workspace())).toEqual({
      ok: false,
      error: "No recording to save: call android_record_start first",
    });
    await recorder.start();
    expect(await recorder.start()).toEqual({ ok: false, error: "A recording is already running" });
  });

  test("a recording that hit Android's limit is saved without signalling the device", async () => {
    const { device, calls, end } = fakeDevice();
    const recorder = createScreenRecorder({ device, now: () => NOW });
    await recorder.start();
    end();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await recorder.stop(await workspace())).ok).toBe(true);
    expect(calls.some((call) => call.startsWith("shell pkill"))).toBe(false);
  });

  test("a recording the device refused says why and can be started again", async () => {
    const { device, end } = fakeDevice();
    const recorder = createScreenRecorder({ device, now: () => NOW });
    await recorder.start();
    end(new Error("screenrecord: not found"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await recorder.stop(await workspace())).toEqual({
      ok: false,
      error: "The recording failed: screenrecord: not found",
    });
    expect(await recorder.start()).toEqual({ ok: true });
  });
});
