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
  const send = (call: string, args: unknown[]) => post(JSON.stringify({ call, args }));
  const sender =
    (call: string) =>
    (...args: unknown[]) =>
      send(call, args);

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
      send("start", [{ ...data, ...(brand === undefined ? {} : { brand }), callbacks }]);
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
      let reply: unknown;
      try {
        reply = JSON.parse(text);
      } catch {
        return;
      }
      if (typeof reply !== "object" || reply === null) return;
      const { callback, args, problem } = reply as Record<string, unknown>;
      if (typeof problem === "string") {
        handlers.get("onProblem")?.(problem);
        return;
      }
      if (typeof callback === "string" && Array.isArray(args)) handlers.get(callback)?.(...args);
    },
  };
}
