import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { bundleBrowserScript } from "../../../packages/server/src/server/plugins/browser-script.js";
import { createWorldScript, worldEntryPath } from "./world-script.js";

const OFFICE_DIRECTORY = fileURLToPath(new URL("..", import.meta.url));

describe("the 3D office's page script", () => {
  it("is built once from the vendored entry and kept", async () => {
    const asked: string[] = [];
    const world = createWorldScript({
      bundle: async (entryPath) => {
        asked.push(entryPath);
        return "script";
      },
      entryPath: worldEntryPath("/plugins/office"),
    });

    expect(await Promise.all([world.read(), world.read()])).toEqual(["script", "script"]);
    expect(await world.read()).toBe("script");
    expect(asked).toEqual(["/plugins/office/vendor/my-office/src/office/paseo-entry.js"]);
  });

  it("builds again after a build that failed", async () => {
    let calls = 0;
    const world = createWorldScript({
      bundle: async () => {
        calls += 1;
        if (calls === 1) throw new Error("no esbuild");
        return "script";
      },
      entryPath: "/entry.js",
    });

    await expect(world.read()).rejects.toThrow("no esbuild");
    expect(await world.read()).toBe("script");
    expect(calls).toBe(2);
  });
});

describe("the vendored entry", () => {
  it("builds into one script that sets the page's API and needs nothing a browser lacks", async () => {
    const script = await bundleBrowserScript(worldEntryPath(OFFICE_DIRECTORY));

    expect(script).toContain("PaseoOfficeWorld");
    // The library's chip and the bookshelf tell Paseo, which opens its Library card.
    expect(script).toContain("onLibrary");
    // A deploy that failed has its own line in the bubble.
    expect(script).toContain("paseo.deploy.failed");
    // The scene with three.js r160; a jump means a module the port leaves out came back in.
    expect(script.length).toBeGreaterThan(600_000);
    expect(script.length).toBeLessThan(1_200_000);
    // Node's globals would throw in the page: upstream's build flag was the one use.
    expect(script).not.toContain("process.env");
    expect(script).not.toMatch(/\brequire\(/);
  }, 60_000);
});
