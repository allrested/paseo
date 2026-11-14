import { describe, expect, test } from "vitest";
import { readStack, type StackPorts } from "./stack.js";

const FILES: Record<string, string> = {
  "/srv/package.json": JSON.stringify({ name: "@getpaseo/server", version: "0.16.0-beta.5" }),
  "/keys/present": "abc\n",
  "/keys/empty": "\n",
};

function ports(
  env: Record<string, string>,
  overrides: Partial<StackPorts> = {},
): { ports: StackPorts; ran: string[] } {
  const ran: string[] = [];
  let clock = 1_000;
  const value: StackPorts = {
    env,
    now: () => (clock += 5),
    uptimeSeconds: () => 3600.4,
    packageJson: "/srv/package.json",
    readText: async (path) => {
      if (!(path in FILES)) throw new Error(`ENOENT: ${path}`);
      return FILES[path]!;
    },
    httpStatus: async (url) => {
      if (url.includes("down")) throw new Error("connect ECONNREFUSED");
      if (url.includes("broken")) return 502;
      return url.startsWith("http://fig:") ? 426 : 200;
    },
    connect: async (host, port) => {
      if (host !== "bare") throw new Error(`connect ECONNREFUSED ${host}:${port}`);
    },
    run: async (command, args) => {
      ran.push([command, ...args].join(" "));
      if (command === "/bin/figcraft-cli") return "figcraft-cli 0.18.1\n";
      if (args.includes("get-state")) return "device\n";
      if (args.includes("getprop")) return "14\n";
      if (args[0] === "connect") return "connected to dev:5555\n";
      if (args[0] === "run" && args[1] === "list") {
        return JSON.stringify([
          {
            databaseId: 9,
            headBranch: "main",
            status: "completed",
            conclusion: "success",
            createdAt: "x",
          },
          {
            databaseId: 7,
            headBranch: "v0.16.0-beta.5",
            status: "completed",
            conclusion: "success",
            createdAt: "2026-11-13T21:27:12Z",
          },
        ]);
      }
      if (args[0] === "run" && args[1] === "view") {
        return JSON.stringify({
          jobs: [
            { name: "publish", status: "completed", conclusion: "success" },
            { name: "deploy", status: "completed", conclusion: "failure" },
          ],
        });
      }
      throw new Error(`unexpected ${command}`);
    },
    which: (name) => `/bin/${name}`,
    ...overrides,
  };
  return { ports: value, ran };
}

describe("Stack readings", () => {
  test("a host with nothing set up reads its Paseo only", async () => {
    const reading = await readStack(ports({}).ports);
    expect(reading).toEqual({
      readAt: expect.any(String),
      paseo: { version: "0.16.0-beta.5", uptimeSeconds: 3600 },
      figcraft: { status: "off" },
      android: { status: "off" },
      deploy: { status: "off" },
    });
  });

  test("Paseo's version only from the server package", async () => {
    const other = { ...FILES, "/srv/package.json": JSON.stringify({ name: "x", version: "1" }) };
    const { ports: p } = ports({}, { readText: async (path) => other[path]! });
    expect((await readStack(p)).paseo.version).toBeNull();
    expect((await readStack(ports({}, { packageJson: null }).ports)).paseo.version).toBeNull();
  });

  test("FigCraft: the server answers any status, the web app a good one, the key only as there or not", async () => {
    const reading = await readStack(
      ports({
        FIGCRAFT_URL: "ws://fig:47900/",
        FIGCRAFT_WEB_URL: "http://web.broken/",
        FIGCRAFT_SERVER_KEY_FILE: "/keys/present",
      }).ports,
    );
    expect(reading.figcraft).toEqual({
      status: "on",
      server: { ok: true, ms: 5, error: null },
      web: { ok: false, ms: 5, error: "HTTP 502" },
      cliVersion: "0.18.1",
      keyFile: "present",
    });
    const down = await readStack(
      ports({ FIGCRAFT_URL: "wss://down/", FIGCRAFT_SERVER_KEY_FILE: "/keys/empty" }).ports,
    );
    expect(down.figcraft).toMatchObject({
      server: { ok: false, ms: null, error: "connect ECONNREFUSED down:443" },
      web: null,
      keyFile: "empty",
    });
    const missing = await readStack(
      ports({ FIGCRAFT_URL: "ws://fig:1/", FIGCRAFT_SERVER_KEY_FILE: "/keys/gone" }).ports,
    );
    expect(missing.figcraft).toMatchObject({ keyFile: "missing" });
  });

  test("FigCraft: a bare server that answers no GET is up when it takes the connection; a proxy's 5xx is down", async () => {
    // "down" in the URL makes the fake's GET fail, as figcraft-server's own port does.
    const bare = await readStack(ports({ FIGCRAFT_URL: "ws://bare:47900/down" }).ports);
    expect(bare.figcraft).toMatchObject({ server: { ok: true, ms: 5, error: null } });
    const gone = await readStack(ports({ FIGCRAFT_URL: "wss://fig.broken/" }).ports);
    expect(gone.figcraft).toMatchObject({ server: { ok: false, ms: 5, error: "HTTP 502" } });
  });

  test("Android: connects a host:port serial, reads its state and version, and whether maestro is there", async () => {
    const { ports: p, ran } = ports({ PASEO_ANDROID_ADB: "dev:5555" });
    expect((await readStack(p)).android).toEqual({
      status: "on",
      state: "device",
      androidVersion: "14",
      maestro: true,
      error: null,
    });
    expect(ran).toEqual([
      "/bin/adb connect dev:5555",
      "/bin/adb -s dev:5555 get-state",
      "/bin/adb -s dev:5555 shell getprop ro.build.version.release",
    ]);
    const noAdb = ports(
      { PASEO_ANDROID_ADB: "dev:5555" },
      { which: (name) => (name === "adb" ? null : `/bin/${name}`) },
    );
    expect((await readStack(noAdb.ports)).android).toMatchObject({ error: "adb is not on PATH" });
    const offline = ports(
      { PASEO_ANDROID_ADB: "emulator-5554" },
      {
        run: async () => {
          throw new Error("error: device offline\nmore");
        },
      },
    );
    expect((await readStack(offline.ports)).android).toMatchObject({
      state: null,
      error: "error: device offline",
    });
  });

  test("Deploy: the newest tag's Docker run and its deploy job", async () => {
    const { ports: p, ran } = ports({ PASEO_DEPLOY_REPO: "allrested/paseo" });
    expect((await readStack(p)).deploy).toEqual({
      status: "on",
      repo: "allrested/paseo",
      tag: "v0.16.0-beta.5",
      runAt: "2026-11-13T21:27:12Z",
      docker: "success",
      deployJob: "failure",
      error: null,
    });
    expect(ran.at(-1)).toBe("/bin/gh run view 7 --repo allrested/paseo --json jobs");
    const noGh = ports({ PASEO_DEPLOY_REPO: "a/b" }, { which: () => null });
    expect((await readStack(noGh.ports)).deploy).toMatchObject({ error: "gh is not on PATH" });
  });
});
