import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";

export interface FakeTarget {
  id: string;
  type: string;
  url: string;
  title: string;
  openerId?: string;
  /** Absent in Chromium's own profile. */
  browserContextId?: string;
}

/** The context id the fake uses for Chromium's own profile in `cookies`. */
export const DEFAULT_CONTEXT = "default";

type FakeCookie = Record<string, unknown>;

export interface FakeCommand {
  targetId: string; // "browser" for the browser socket
  method: string;
  params: Record<string, unknown>;
}

type Handler = (params: Record<string, unknown>, targetId: string) => unknown;

export interface FakeChromium {
  readonly url: string;
  readonly port: number;
  readonly targets: Map<string, FakeTarget>;
  readonly hostHeaders: string[];
  readonly commands: FakeCommand[];
  /**
   * Each context's cookies as they were set, by context id; DEFAULT_CONTEXT is Chromium's own
   * profile. A context that is not listed does not exist.
   */
  readonly cookies: Map<string, FakeCookie[]>;
  /** Names of cookies Chromium cannot make: a setCookies call that holds one fails whole. */
  readonly refusedCookieNames: Set<string>;
  /** Names of cookies Chromium drops without an error. */
  readonly droppedCookieNames: Set<string>;
  /** Replaces the answer for one method. Throwing answers with a CDP error; a promise answers when it settles. */
  handle(method: string, handler: Handler): void;
  /** The method never answers, so the caller times out. */
  stall(method: string): void;
  /** Later calls answer again; a call already stalled stays unanswered. */
  unstall(method: string): void;
  emit(targetId: string, method: string, params: Record<string, unknown>): void;
  addTarget(input?: Partial<FakeTarget>): FakeTarget;
  destroyTarget(targetId: string): void;
  /** Chromium restarted or dropped the context: it is gone, with its cookies and its tabs. */
  dropContext(contextId: string): void;
  socketCount(targetId: string): number;
  /** Drops every socket of one target ("browser" for the browser socket); the target stays. */
  disconnect(targetId: string): void;
  close(): Promise<void>;
}

const IP_HOST = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/;

export async function startFakeChromium(): Promise<FakeChromium> {
  const targets = new Map<string, FakeTarget>();
  const hostHeaders: string[] = [];
  const commands: FakeCommand[] = [];
  const handlers = new Map<string, Handler>();
  const stalled = new Set<string>();
  const sockets = new Map<string, Set<WebSocket>>();
  const cookies = new Map<string, FakeCookie[]>([[DEFAULT_CONTEXT, []]]);
  const refusedCookieNames = new Set<string>();
  const droppedCookieNames = new Set<string>();

  const emit = (targetId: string, method: string, params: Record<string, unknown>) => {
    for (const socket of sockets.get(targetId) ?? [])
      socket.send(JSON.stringify({ method, params }));
  };
  const addTarget = (input: Partial<FakeTarget> = {}): FakeTarget => {
    const target: FakeTarget = {
      id: input.id ?? randomUUID().replaceAll("-", "").toUpperCase(),
      type: input.type ?? "page",
      url: input.url ?? "about:blank",
      title: input.title ?? "",
      ...(input.openerId ? { openerId: input.openerId } : {}),
      ...(input.browserContextId ? { browserContextId: input.browserContextId } : {}),
    };
    targets.set(target.id, target);
    emit("browser", "Target.targetCreated", {
      targetInfo: {
        targetId: target.id,
        type: target.type,
        url: target.url,
        title: target.title,
        openerId: target.openerId,
        browserContextId: target.browserContextId,
      },
    });
    return target;
  };
  const destroyTarget = (targetId: string) => {
    if (!targets.delete(targetId)) return;
    for (const socket of sockets.get(targetId) ?? []) socket.close();
    sockets.delete(targetId);
    emit("browser", "Target.targetDestroyed", { targetId });
  };

  const dropContext = (contextId: string) => {
    if (!cookies.delete(contextId)) return;
    // A copy: destroying a target takes it out of the map this walks.
    for (const target of Array.from(targets.values())) {
      if (target.browserContextId === contextId) destroyTarget(target.id);
    }
  };
  const contextOf = (params: Record<string, unknown>): string => {
    const contextId =
      typeof params.browserContextId === "string" ? params.browserContextId : DEFAULT_CONTEXT;
    if (!cookies.has(contextId)) {
      throw new Error(`Failed to find browser context for id ${contextId}`);
    }
    return contextId;
  };

  handlers.set("Target.createTarget", (params) => {
    const contextId = typeof params.browserContextId === "string" ? params.browserContextId : null;
    // Chromium's whole message for a context it does not have.
    if (contextId !== null && !cookies.has(contextId)) throw new Error("browserContextId");
    return {
      targetId: addTarget({
        url: typeof params.url === "string" ? params.url : "about:blank",
        ...(contextId === null ? {} : { browserContextId: contextId }),
      }).id,
    };
  });
  handlers.set("Target.createBrowserContext", () => {
    const browserContextId = randomUUID().replaceAll("-", "").toUpperCase();
    cookies.set(browserContextId, []);
    return { browserContextId };
  });
  handlers.set("Target.getBrowserContexts", () => ({
    browserContextIds: [...cookies.keys()].filter((id) => id !== DEFAULT_CONTEXT),
  }));
  handlers.set("Target.disposeBrowserContext", (params) => {
    const contextId = contextOf(params);
    if (contextId !== DEFAULT_CONTEXT) dropContext(contextId);
    return {};
  });
  handlers.set("Storage.getCookies", (params) => ({
    // As Chromium reports them: a session cookie has no expiry of its own.
    cookies: (cookies.get(contextOf(params)) ?? []).map((cookie) =>
      Object.assign({}, cookie, {
        expires: typeof cookie.expires === "number" ? cookie.expires : -1,
        session: typeof cookie.expires !== "number",
        size: String(cookie.name).length + String(cookie.value).length,
      }),
    ),
  }));
  handlers.set("Storage.setCookies", (params) => {
    const jar = cookies.get(contextOf(params)) ?? [];
    const given = Array.isArray(params.cookies) ? (params.cookies as FakeCookie[]) : [];
    // One cookie Chromium cannot make fails the whole call, and nothing is set.
    const valid = (cookie: FakeCookie) =>
      typeof cookie.name === "string" &&
      cookie.name !== "" &&
      typeof cookie.value === "string" &&
      typeof cookie.domain === "string" &&
      cookie.domain !== "" &&
      !refusedCookieNames.has(cookie.name);
    if (!given.every(valid)) throw new Error("Invalid cookie fields");
    const keyOf = (cookie: FakeCookie) => [cookie.name, cookie.domain, cookie.path].join("\n");
    for (const cookie of given) {
      if (droppedCookieNames.has(String(cookie.name))) continue;
      const at = jar.findIndex((each) => keyOf(each) === keyOf(cookie));
      if (at === -1) jar.push(cookie);
      else jar[at] = cookie;
    }
    return {};
  });
  handlers.set("Target.closeTarget", (params) => {
    destroyTarget(String(params.targetId));
    return { success: true };
  });
  handlers.set("Runtime.evaluate", () => ({ result: { type: "undefined" } }));
  handlers.set("Page.getNavigationHistory", (_params, targetId) => {
    const target = targets.get(targetId);
    return {
      currentIndex: 0,
      entries: [{ id: 1, url: target?.url ?? "", title: target?.title ?? "" }],
    };
  });

  const http: Server = createServer((request, response) => {
    const host = request.headers.host ?? "";
    hostHeaders.push(host);
    // Chrome answers 500 to any Host header that is not an IP or localhost.
    if (!IP_HOST.test(host) && !host.startsWith("localhost")) {
      response
        .writeHead(500)
        .end("Host header is specified and is not an IP address or localhost.");
      return;
    }
    // The advertised WebSocket URLs carry a wrong origin on purpose: a client must not use them as-is.
    const json = (body: unknown) =>
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
    if (request.url === "/json/version") {
      json({
        Browser: "FakeChromium/1.0",
        webSocketDebuggerUrl: "ws://127.0.0.1:1/devtools/browser/fake-browser",
      });
      return;
    }
    if (request.url === "/json/list") {
      json(
        [...targets.values()].map((target) => ({
          id: target.id,
          type: target.type,
          url: target.url,
          title: target.title,
          openerId: target.openerId,
          webSocketDebuggerUrl: `ws://127.0.0.1:1/devtools/page/${target.id}`,
        })),
      );
      return;
    }
    response.writeHead(404).end();
  });

  const wss = new WebSocketServer({ noServer: true });
  http.on("upgrade", (request, socket, head) => {
    const match = /^\/devtools\/(browser|page)\/(.+)$/.exec(request.url ?? "");
    const targetId = match?.[1] === "browser" ? "browser" : match?.[2];
    if (!targetId || (targetId !== "browser" && !targets.has(targetId))) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      const set = sockets.get(targetId) ?? new Set<WebSocket>();
      sockets.set(targetId, set);
      set.add(ws);
      ws.on("close", () => set.delete(ws));
      ws.on("message", (data) => {
        const message = JSON.parse(String(data)) as {
          id: number;
          method: string;
          params?: Record<string, unknown>;
        };
        const params = message.params ?? {};
        commands.push({ targetId, method: message.method, params });
        if (stalled.has(message.method)) return;
        const answer = (result: unknown) => ws.send(JSON.stringify({ id: message.id, result }));
        const fail = (error: unknown) =>
          ws.send(
            JSON.stringify({
              id: message.id,
              error: { code: -32000, message: String((error as Error).message) },
            }),
          );
        try {
          const result = handlers.get(message.method)?.(params, targetId) ?? {};
          // A handler that returns a promise answers when it settles: a command that takes a while.
          if (result instanceof Promise) result.then(answer, fail);
          else answer(result);
        } catch (error) {
          fail(error);
        }
      });
    });
  });

  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const port = (http.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    targets,
    hostHeaders,
    commands,
    cookies,
    refusedCookieNames,
    droppedCookieNames,
    dropContext,
    handle: (method, handler) => void handlers.set(method, handler),
    stall: (method) => void stalled.add(method),
    unstall: (method) => void stalled.delete(method),
    emit,
    addTarget,
    destroyTarget,
    socketCount: (targetId) => sockets.get(targetId)?.size ?? 0,
    disconnect: (targetId) => {
      for (const socket of sockets.get(targetId) ?? []) socket.terminate();
    },
    close: async () => {
      for (const set of sockets.values()) for (const socket of set) socket.terminate();
      wss.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}
