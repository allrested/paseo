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
import { DeviceUnreachableError, UNREACHABLE, errorMessage } from "./errors.js";
import { centerOf, parseSnapshot, snapshotText, type ScreenElement } from "./snapshot.js";

type ToolAgent = Pick<PluginHookAgent, "id" | "cwd">;

export interface AndroidToolPorts {
  device: AndroidDevice;
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
      description: "Swipe from one point to another, in device pixels. Use it to scroll.",
      input: z.object({
        from: PointSchema,
        to: PointSchema,
        durationMs: z.number().int().min(50).max(3000).default(300),
      }),
      async run(input) {
        await device.swipe(input.from, input.to, input.durationMs);
        return {
          text: `Swiped from ${input.from.x},${input.from.y} to ${input.to.x},${input.to.y}.`,
        };
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
      description: "Open an installed app by its package name, such as com.example.app.",
      input: z.object({ package: z.string().min(1).max(200) }),
      async run(input) {
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
