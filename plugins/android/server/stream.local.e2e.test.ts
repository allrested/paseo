// Hand-run only: set PASEO_TEST_ANDROID_ADB to a device serial (host:port) and put adb on PATH.
// It opens a stream with the real clock, presses Home and opens Settings; it installs nothing.
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import type { AndroidStreamEvent } from "../shared/contracts.js";
import { createAdbRunner, findOnPath } from "./adb.js";
import { createAndroidDevice } from "./device.js";
import { createAndroidStreams } from "./stream.js";
import { nodeClock } from "./timers.js";

const SERIAL = process.env.PASEO_TEST_ANDROID_ADB;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function until<T>(read: () => T | undefined, what: string, ms = 15_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

test.skipIf(!SERIAL)("a stream on a real Android device", { timeout: 60_000 }, async () => {
  const adbPath = findOnPath("adb", process.env);
  expect(adbPath).not.toBeNull();
  const device = createAndroidDevice({
    serial: SERIAL!,
    adb: createAdbRunner({ adbPath: adbPath! }),
  });
  const streams = createAndroidStreams({
    device,
    clock: nodeClock,
    newStreamId: () => "e2e",
    log: (message) => console.error(message),
  });
  const events: AndroidStreamEvent[] = [];
  const controller = new AbortController();
  const served = streams.attach({
    signal: controller.signal,
    push: async (event) => {
      events.push(event);
    },
  });
  const pictures = () => events.flatMap((event) => (event.type === "picture" ? [event] : []));

  const ready = await until(() => events.find((event) => event.type === "ready"), "ready");
  expect(ready).toMatchObject({ width: 720, height: 1280 });
  const first = await until(() => pictures()[0], "the first picture");
  expect(Buffer.from(first.png, "base64").subarray(0, 8)).toEqual(PNG_SIGNATURE);
  await streams.input({ streamId: "e2e", shown: first.seq });

  expect(await streams.input({ streamId: "e2e", key: "home" })).toEqual({ ok: true });
  await device.shell(["am", "start", "-a", "android.settings.SETTINGS"]);
  const last = await until(
    () => pictures().find((picture) => picture.seq > first.seq && picture.png !== first.png),
    "a different picture",
  );
  expect(last.png).not.toBe(first.png);
  await writeFile(
    join(tmpdir(), "android-stream.png"),
    Buffer.from(pictures().at(-1)!.png, "base64"),
  );

  controller.abort();
  await served;
  await streams.stop();
});
