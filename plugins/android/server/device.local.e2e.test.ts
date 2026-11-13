// Hand-run only: set PASEO_TEST_ANDROID_ADB to a device serial (host:port) and put adb on PATH.
// It opens Settings and types in its search field; it installs nothing and changes no setting.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createAdbRunner, findOnPath } from "./adb.js";
import { createAndroidTools } from "./agent-tools.js";
import { createAndroidDevice } from "./device.js";

const SERIAL = process.env.PASEO_TEST_ANDROID_ADB;
let directory = "";
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "android-e2e-"));
});
afterAll(() => rm(directory, { recursive: true, force: true }));

describe.skipIf(!SERIAL)("a real Android device", () => {
  test("snapshot Settings, tap a row by ref, type in search, save a screenshot", async () => {
    const adbPath = findOnPath("adb", process.env);
    expect(adbPath).not.toBeNull();
    const device = createAndroidDevice({
      serial: SERIAL!,
      adb: createAdbRunner({ adbPath: adbPath! }),
    });
    const tools = createAndroidTools({
      device,
      workspacePath: () => directory,
      now: () => new Date(),
    });
    const agent = { id: "a1", cwd: directory } as never;
    const run = async (name: string, input: object) => {
      const tool = tools.find((candidate) => candidate.name === name)!;
      return tool.execute(tool.input.parse(input), { agent } as never);
    };
    await device.stop("com.android.settings");
    await device.shell(["am", "start", "-a", "android.settings.SETTINGS"]);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const snapshot = await run("android_snapshot", {});
    console.log(snapshot.text);
    expect(snapshot.text).toContain("com.android.settings");
    const row = /^(@a\d+) "Network & internet"/m.exec(snapshot.text ?? "");
    expect(row, "a Network & internet row").not.toBeNull();
    const tapped = await run("android_tap", { ref: row![1]! });
    expect(tapped.isError).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect((await run("android_snapshot", {})).text).not.toEqual(snapshot.text);
    await run("android_key", { key: "back" });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const home = await run("android_snapshot", {});
    const search = /^(@a\d+) (?:"[^"]*" )?\[button\] id=\S*search\S*/im.exec(home.text ?? "");
    if (search) {
      await run("android_tap", { ref: search[1]! });
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    const typed = await run("android_type", { text: "wifi it's" });
    expect(typed.isError).toBeUndefined();
    const shot = await run("android_screenshot", {});
    const path = (shot.structuredContent as { path: string }).path;
    expect((await readFile(path)).subarray(1, 4).toString()).toBe("PNG");
    await device.key("KEYCODE_HOME");
  }, 60_000);
});
