import { WORLD_API_VERSION, type WorldApi, type WorldStartOptions } from "./world-api.js";

/** From the plugin to the page: a call of `PaseoOfficeWorld`. */
export interface BridgeCall {
  call: string;
  args: unknown[];
}

/** From the page to the plugin: a callback the plugin gave `start`, or a problem. */
export type BridgeReply = { callback: string; args: unknown[] } | { problem: string };

export interface WorldBridge {
  api: WorldApi;
  receive(text: string): void;
}

type Handler = (...args: unknown[]) => void;

/** The page's reply in `text`, or null for text that is not one. */
function parseReply(text: string): BridgeReply | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { callback, args, problem } = value as Record<string, unknown>;
  if (typeof problem === "string") return { problem };
  if (typeof callback === "string" && Array.isArray(args)) return { callback, args };
  return null;
}

/** The sign shows a logo only from a `data:` URL: the page's policy refuses any other image. */
function brandForPage(brand: WorldStartOptions["brand"]): WorldStartOptions["brand"] {
  if (brand === undefined) return undefined;
  return {
    name: brand.name,
    logoUrl: brand.logoUrl?.startsWith("data:") ? brand.logoUrl : null,
  };
}

/**
 * The scene's API over messages. Each call becomes `{ call, args }` for `post`; the page answers
 * with `{ callback, args }` for a callback `start` was given, or `{ problem }`. Nothing waits here:
 * `post` is a ScriptFrame handle's, which holds posts until the page is ready.
 */
export function createWorldBridge(post: (text: string) => void): WorldBridge {
  const handlers = new Map<string, Handler>();
  const send = (message: BridgeCall) => post(JSON.stringify(message));
  const sender =
    (call: string) =>
    (...args: unknown[]) =>
      send({ call, args });

  const api: WorldApi = {
    version: WORLD_API_VERSION,
    start(options) {
      handlers.clear();
      const data: Record<string, unknown> = {};
      const callbacks: string[] = [];
      for (const [key, value] of Object.entries(options)) {
        if (typeof value === "function") {
          handlers.set(key, value as Handler);
          callbacks.push(key);
        } else if (key !== "brand") {
          data[key] = value;
        }
      }
      const brand = brandForPage(options.brand);
      send({
        call: "start",
        args: [{ ...data, ...(brand === undefined ? {} : { brand }), callbacks }],
      });
    },
    stop: sender("stop"),
    setTheme: sender("setTheme"),
    setSessions: sender("setSessions"),
    event: sender("event"),
    select: sender("select"),
    focusProject: sender("focusProject"),
    setBoardRows: sender("setBoardRows"),
    setMachine: sender("setMachine"),
    meet: sender("meet"),
    gather: sender("gather"),
    setIncidents: sender("setIncidents"),
  };

  return {
    api,
    receive(text) {
      const reply = parseReply(text);
      if (reply === null) return;
      if ("problem" in reply) handlers.get("onProblem")?.(reply.problem);
      else handlers.get(reply.callback)?.(...reply.args);
    },
  };
}
