import { chmod, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { createMaestroRunner, MAESTRO_LIMIT_MS, type MaestroRunnerDeps } from "./maestro.js";
import { nodeClock } from "./timers.js";

let directory = "";
let fake = "";
let argvFile = "";

// A fake maestro: records its argv and working folder, then passes, fails or hangs.
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "android-maestro-"));
  fake = join(directory, "maestro");
  argvFile = join(directory, "argv.txt");
  await writeFile(
    fake,
    `#!/bin/sh
{ pwd; printf '%s\\n' "$@"; } > "${argvFile}"
out=""; debug=""
while [ $# -gt 0 ]; do
  case "$1" in
    --output) out="$2"; shift ;;
    --debug-output) debug="$2"; shift ;;
  esac
  shift
done
echo 'Launch app "com.example"... COMPLETED'
case "$FAKE_MAESTRO_MODE" in
  pass) echo 'Tap on "Login"... COMPLETED'; exit 0 ;;
  fail)
    echo 'Tap on "Login"... FAILED'
    mkdir -p "$debug"; printf 'png' > "$debug/screenshot-failed.png"
    printf '<?xml version="1.0"?><testsuites><testsuite name="Test Suite"><testcase id="login" name="login"><failure>Element not found: Text matching regex: Login</failure></testcase></testsuite></testsuites>' > "$out"
    exit 1 ;;
  hang) exec sleep 30 ;;
esac
exit 2
`,
  );
  await chmod(fake, 0o755);
});

async function workspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "android-maestro-ws-"));
  const files = [
    ".maestro/login.yaml",
    ".maestro/config.yaml",
    ".maestro/subflows/step.yaml",
    "packages/app/maestro/create.yml",
    "packages/app/maestro/README.md",
    "a/b/c/maestro/too-deep.yaml",
    "node_modules/x/maestro/dep.yaml",
  ];
  for (const file of files) {
    await mkdir(join(dir, file, ".."), { recursive: true });
    await writeFile(join(dir, file), "appId: com.example\n---\n- launchApp\n");
  }
  return dir;
}

function setup(mode: string, overrides: Partial<MaestroRunnerDeps> = {}) {
  const runsDir = join(directory, `runs-${Math.random().toString(36).slice(2)}`);
  let next = 0;
  const runner = createMaestroRunner({
    command: fake,
    serial: "127.0.0.1:5555",
    runsDir,
    env: { ...process.env, FAKE_MAESTRO_MODE: mode },
    clock: nodeClock,
    newId: () => `run-${String(++next).padStart(3, "0")}`,
    log: () => undefined,
    ...overrides,
  });
  return { runner, runsDir };
}

async function ended(runner: ReturnType<typeof createMaestroRunner>) {
  await vi.waitFor(() => expect(runner.state()?.status).not.toBe("running"), { timeout: 5000 });
  return runner.state();
}

describe("Maestro flows", () => {
  test("lists top-level flows in .maestro and maestro folders up to three levels down", async () => {
    const { runner } = setup("pass");
    expect(await runner.flows(await workspace())).toEqual([
      ".maestro/login.yaml",
      "packages/app/maestro/create.yml",
    ]);
  });

  test("runs a flow on the device from the workspace folder and passes", async () => {
    const dir = await workspace();
    const { runner, runsDir } = setup("pass");
    expect(await runner.start({ dir, flow: ".maestro/login.yaml" })).toEqual({ ok: true });
    const run = await ended(runner);
    expect(run).toMatchObject({
      id: "run-001",
      flow: ".maestro/login.yaml",
      status: "passed",
      failedStep: null,
      message: null,
      hasPicture: false,
    });
    expect(run?.output).toEqual([
      'Launch app "com.example"... COMPLETED',
      'Tap on "Login"... COMPLETED',
    ]);
    const [cwd, ...argv] = (await readFile(argvFile, "utf8")).trim().split("\n");
    expect(await import("node:fs/promises").then((fs) => fs.realpath(cwd))).toBe(
      await import("node:fs/promises").then((fs) => fs.realpath(dir)),
    );
    const runDir = join(runsDir, "run-001");
    expect(argv).toEqual([
      "--device",
      "127.0.0.1:5555",
      "test",
      ".maestro/login.yaml",
      "--format",
      "JUNIT",
      "--output",
      join(runDir, "report.xml"),
      "--debug-output",
      join(runDir, "debug"),
      "--flatten-debug-output",
      "--no-ansi",
    ]);
  });

  test("a failure gives the failing step, the report's message and the picture", async () => {
    const dir = await workspace();
    const { runner } = setup("fail");
    await runner.start({ dir, flow: ".maestro/login.yaml" });
    expect(await ended(runner)).toMatchObject({
      status: "failed",
      failedStep: 'Tap on "Login"',
      message: "Element not found: Text matching regex: Login",
      hasPicture: true,
    });
    expect((await runner.failurePicture("run-001"))?.toString()).toBe("png");
    expect(await runner.failurePicture("run-404")).toBeNull();
  });

  test("runs one flow at a time, and Stop ends it", async () => {
    const dir = await workspace();
    const { runner } = setup("hang");
    await runner.start({ dir, flow: ".maestro/login.yaml" });
    expect(await runner.start({ dir, flow: ".maestro/login.yaml" })).toEqual({
      ok: false,
      error: "A flow is already running",
    });
    await runner.stop();
    expect(await ended(runner)).toMatchObject({ status: "stopped", message: "Stopped" });
  });

  test("stops a run at the time limit", async () => {
    const dir = await workspace();
    const limits: (() => void)[] = [];
    const { runner } = setup("hang", {
      clock: {
        now: () => Date.now(),
        setTimeout: (run, ms) => {
          if (ms === MAESTRO_LIMIT_MS) limits.push(run);
          return () => undefined;
        },
      },
    });
    await runner.start({ dir, flow: ".maestro/login.yaml" });
    expect(limits).toHaveLength(1);
    limits[0]();
    expect(await ended(runner)).toMatchObject({
      status: "stopped",
      message: "Stopped after 15 minutes",
    });
  });

  test("refuses a flow the workspace does not list", async () => {
    const dir = await workspace();
    const { runner } = setup("pass");
    for (const flow of ["../outside.yaml", ".maestro/config.yaml", "a/b/c/maestro/too-deep.yaml"]) {
      expect(await runner.start({ dir, flow })).toEqual({
        ok: false,
        error: "No such flow in this workspace",
      });
    }
    expect(runner.state()).toBeNull();
  });

  test("keeps the newest 10 runs", async () => {
    const dir = await workspace();
    const { runner, runsDir } = setup("pass");
    for (let old = 0; old < 12; old++)
      await mkdir(join(runsDir, `old-${old}`), { recursive: true });
    await runner.start({ dir, flow: ".maestro/login.yaml" });
    await ended(runner);
    const kept = (await readdir(runsDir)).sort();
    expect(kept).toHaveLength(10);
    expect(kept).toContain("run-001");
  });

  test("tells watchers about every change", async () => {
    const dir = await workspace();
    const { runner } = setup("pass");
    const seen: (string | undefined)[] = [];
    const unwatch = runner.watch((run) => seen.push(run?.status));
    await runner.start({ dir, flow: ".maestro/login.yaml" });
    await ended(runner);
    unwatch();
    expect(seen[0]).toBe("running");
    expect(seen.at(-1)).toBe("passed");
  });
});
