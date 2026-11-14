import { mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  defineAgentTool,
  type AgentToolDefinition,
  type AgentToolResult,
  type PluginHookAgent,
} from "@getpaseo/plugin/server";
import { z } from "zod";
import type { AndroidDevice } from "./device.js";
import type { ScreenRecorder } from "./recorder.js";
import { DeviceUnreachableError, UNREACHABLE, errorMessage } from "./errors.js";
import { centerOf, parseSnapshot, snapshotText, type ScreenElement } from "./snapshot.js";

type ToolAgent = Pick<PluginHookAgent, "id" | "cwd">;

export interface AndroidToolPorts {
  device: AndroidDevice;
  recorder: ScreenRecorder;
  /** The folder the agent works in, or null when it has none. */
  workspacePath(agent: ToolAgent): string | null;
  now(): Date;
}

const STALE_REF = "Take a new snapshot: that ref is not on the screen any more";
const LOG_CHARS = 20_000;
const SNAPSHOT_AGENTS = 50;

const KEY_ALIASES: Record<string, string> = {
  BACK: "KEYCODE_BACK",
  HOME: "KEYCODE_HOME",
  RECENTS: "KEYCODE_APP_SWITCH",
  ENTER: "KEYCODE_ENTER",
  DELETE: "KEYCODE_DEL",
};

function keycodeFor(key: string): string {
  const upper = key.toUpperCase();
  if (/^\d+$/.test(key)) return key;
  return KEY_ALIASES[upper] ?? (upper.startsWith("KEYCODE_") ? upper : `KEYCODE_${upper}`);
}

const PointSchema = z.object({ x: z.number(), y: z.number() });

const TapInputSchema = z
  .object({
    ref: z
      .string()
      .regex(/^@a\d+$/)
      .optional(),
    x: z.number().optional(),
    y: z.number().optional(),
  })
  .refine(
    (input) =>
      input.ref !== undefined
        ? input.x === undefined && input.y === undefined
        : input.x !== undefined && input.y !== undefined,
    { message: "Give either ref, or both x and y" },
  );

const SWIPE_FRACTION = 0.4;

const SwipeInputSchema = z
  .object({
    from: PointSchema.optional(),
    to: PointSchema.optional(),
    direction: z.enum(["up", "down", "left", "right"]).optional(),
    durationMs: z.number().int().min(50).max(3000).default(300),
  })
  .refine(
    (input) =>
      input.direction !== undefined
        ? input.from === undefined && input.to === undefined
        : input.from !== undefined && input.to !== undefined,
    { message: "Give either from and to, or a direction" },
  );

/** From the middle of the screen, 40% of the screen along the axis, the way the finger moves. */
function swipeByDirection(
  direction: "up" | "down" | "left" | "right",
  width: number,
  height: number,
) {
  const from = { x: Math.round(width / 2), y: Math.round(height / 2) };
  const dx = Math.round(width * SWIPE_FRACTION);
  const dy = Math.round(height * SWIPE_FRACTION);
  const to = {
    up: { x: from.x, y: from.y - dy },
    down: { x: from.x, y: from.y + dy },
    left: { x: from.x - dx, y: from.y },
    right: { x: from.x + dx, y: from.y },
  }[direction];
  return { from, to };
}

function isInside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

/** The real path of an APK that is inside the workspace or the home folder; throws with the reason. */
async function checkedApk(path: string, workspace: string | null): Promise<string> {
  const base = workspace ?? homedir();
  const wanted = resolve(base, path);
  if (!wanted.toLowerCase().endsWith(".apk")) throw new Error("Only a .apk file can be installed");
  let real: string;
  try {
    real = await realpath(wanted);
  } catch {
    throw new Error(`${wanted} does not exist`);
  }
  const roots = [homedir(), ...(workspace === null ? [] : [workspace])];
  let allowed = false;
  for (const root of roots) {
    try {
      if (isInside(await realpath(root), real)) allowed = true;
    } catch {
      // A root that is not there allows nothing.
    }
  }
  if (!allowed) throw new Error("That file is outside the workspace and the home folder");
  if (!real.toLowerCase().endsWith(".apk")) throw new Error("Only a .apk file can be installed");
  if (!(await stat(real)).isFile()) throw new Error(`${real} is not a file`);
  return real;
}

// Runs inside the daemon process: no tool throws; a failure is the tool's answer.
export function createAndroidTools(ports: AndroidToolPorts): AgentToolDefinition[] {
  const { device } = ports;
  // The last snapshot each agent took; refs mean what that snapshot says.
  const snapshots = new Map<string, ScreenElement[]>();

  function remember(agentId: string, elements: ScreenElement[]) {
    snapshots.delete(agentId);
    snapshots.set(agentId, elements);
    if (snapshots.size > SNAPSHOT_AGENTS) {
      const oldest = snapshots.keys().next().value;
      if (oldest !== undefined) snapshots.delete(oldest);
    }
  }

  function tool<Input extends z.ZodType>(definition: {
    name: string;
    description: string;
    input: Input;
    run(input: z.output<Input>, agent: PluginHookAgent): Promise<AgentToolResult>;
  }): AgentToolDefinition {
    return defineAgentTool({
      name: definition.name,
      description: definition.description,
      input: definition.input,
      async execute(input, { agent }) {
        try {
          return await definition.run(input, agent);
        } catch (error) {
          const text = error instanceof DeviceUnreachableError ? UNREACHABLE : errorMessage(error);
          return { text, isError: true };
        }
      },
    });
  }

  return [
    tool({
      name: "android_snapshot",
      description:
        "Read the Android screen: the app in front and one line per element with a ref such as @a3. Use the ref with android_tap. Refs belong to your latest snapshot; take a new one after the screen changes.",
      input: z.object({}),
      async run(_input, agent) {
        await device.ensure();
        const [xml, focus] = await Promise.all([device.dump(), device.focus()]);
        const elements = parseSnapshot(xml);
        remember(agent.id, elements);
        return { text: snapshotText({ ...focus, elements }) };
      },
    }),
    tool({
      name: "android_tap",
      description:
        'Tap an element of your latest android_snapshot by ref (ref: "@a3"), or a point in device pixels (x and y).',
      input: TapInputSchema,
      async run(input, agent) {
        if (input.ref !== undefined) {
          const element = snapshots.get(agent.id)?.find((candidate) => candidate.ref === input.ref);
          if (!element) return { text: STALE_REF, isError: true };
          const { x, y } = centerOf(element);
          await device.tap(x, y);
          return { text: `Tapped ${input.ref} at ${x},${y}.` };
        }
        await device.tap(input.x!, input.y!);
        return { text: `Tapped ${input.x},${input.y}.` };
      },
    }),
    tool({
      name: "android_type",
      description:
        "Type text into the focused field (tap the field first). Printable ASCII only; for Enter use android_key.",
      input: z.object({ text: z.string().min(1).max(500) }),
      async run(input) {
        await device.text(input.text);
        return { text: `Typed ${input.text.length} character(s).` };
      },
    }),
    tool({
      name: "android_key",
      description:
        "Press a key: back, home, recents, enter, delete, or an Android key name such as KEYCODE_VOLUME_UP.",
      input: z.object({
        key: z
          .string()
          .regex(/^[A-Za-z0-9_]+$/)
          .max(64),
      }),
      async run(input) {
        const keycode = keycodeFor(input.key);
        await device.key(keycode);
        return { text: `Pressed ${keycode}.` };
      },
    }),
    tool({
      name: "android_swipe",
      description:
        "Swipe between two points (from, to) or in a direction (up, down, left, right) from the middle of the screen, in device pixels. Use it to scroll.",
      input: SwipeInputSchema,
      async run(input) {
        const durationMs = input.durationMs;
        if (input.direction !== undefined) {
          const { width, height } = await device.size();
          const { from, to } = swipeByDirection(input.direction, width, height);
          await device.swipe(from, to, durationMs);
          return { text: `Swiped ${input.direction} from ${from.x},${from.y} to ${to.x},${to.y}.` };
        }
        const { from, to } = input;
        await device.swipe(from!, to!, durationMs);
        return { text: `Swiped from ${from!.x},${from!.y} to ${to!.x},${to!.y}.` };
      },
    }),
    tool({
      name: "android_screenshot",
      description:
        "Save a screenshot of the Android screen as a PNG file in your workspace and answer its path.",
      input: z.object({}),
      async run(_input, agent) {
        const workspace = ports.workspacePath(agent);
        if (workspace === null)
          return { text: "This agent has no workspace folder", isError: true };
        const png = await device.screenshot();
        let directory = join(workspace, ".paseo", "android");
        try {
          await mkdir(directory, { recursive: true });
        } catch {
          directory = workspace;
        }
        const name = `android-${ports.now().toISOString().replace(/[:.]/g, "-")}.png`;
        const path = join(directory, name);
        await writeFile(path, png);
        return { text: `Screenshot saved to ${path}`, structuredContent: { path } };
      },
    }),
    tool({
      name: "android_record_start",
      description:
        "Start recording the Android screen as a video, up to 3 minutes (Android's limit). Call android_record_stop to save it in your workspace. One recording at a time on this host.",
      input: z.object({}),
      async run() {
        const started = await ports.recorder.start();
        if (!started.ok) return { text: started.error, isError: true };
        return { text: "Recording the Android screen. Call android_record_stop to save it." };
      },
    }),
    tool({
      name: "android_record_stop",
      description:
        "Stop the screen recording and save it as an MP4 file in your workspace; answers its path.",
      input: z.object({}),
      async run(_input, agent) {
        const workspace = ports.workspacePath(agent);
        if (workspace === null)
          return { text: "This agent has no workspace folder", isError: true };
        const saved = await ports.recorder.stop(workspace);
        if (!saved.ok) return { text: saved.error, isError: true };
        return {
          text: `Recording saved to ${saved.path}`,
          structuredContent: { path: saved.path },
        };
      },
    }),
    tool({
      name: "android_install",
      description:
        "Install an APK (replacing the app when it is there) from a path inside your workspace or the home folder.",
      input: z.object({ path: z.string().min(1) }),
      async run(input, agent) {
        const apk = await checkedApk(input.path, ports.workspacePath(agent));
        await device.install(apk);
        return { text: `Installed ${apk}.` };
      },
    }),
    tool({
      name: "android_launch",
      description:
        'Open an installed app by its package name, such as com.example.app; action "stop" force-stops it instead.',
      input: z.object({
        package: z.string().min(1).max(200),
        action: z.enum(["start", "stop"]).default("start"),
      }),
      async run(input) {
        if (input.action === "stop") {
          await device.stop(input.package);
          return { text: `Stopped ${input.package}.` };
        }
        await device.launch(input.package);
        return { text: `Launched ${input.package}.` };
      },
    }),
    tool({
      name: "android_logs",
      description:
        "Read the device log: the latest lines, or only those of one app when you give its package.",
      input: z.object({
        package: z.string().min(1).max(200).optional(),
        lines: z.number().int().min(1).max(500).default(100),
      }),
      async run(input) {
        const log = await device.logs({
          ...(input.package === undefined ? {} : { packageName: input.package }),
          lines: input.lines,
        });
        return { text: log.length > LOG_CHARS ? log.slice(-LOG_CHARS) : log };
      },
    }),
  ];
}
