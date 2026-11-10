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
}

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
  /** Replaces the answer for one method. Throwing answers with a CDP error. */
  handle(method: string, handler: Handler): void;
  /** The method never answers, so the caller times out. */
  stall(method: string): void;
  emit(targetId: string, method: string, params: Record<string, unknown>): void;
  addTarget(input?: Partial<FakeTarget>): FakeTarget;
  destroyTarget(targetId: string): void;
  socketCount(targetId: string): number;
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
    };
    targets.set(target.id, target);
    emit("browser", "Target.targetCreated", {
      targetInfo: {
        targetId: target.id,
        type: target.type,
        url: target.url,
        title: target.title,
        openerId: target.openerId,
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

  handlers.set("Target.createTarget", (params) => ({
    targetId: addTarget({ url: typeof params.url === "string" ? params.url : "about:blank" }).id,
  }));
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
        try {
          const result = handlers.get(message.method)?.(params, targetId) ?? {};
          ws.send(JSON.stringify({ id: message.id, result }));
        } catch (error) {
          ws.send(
            JSON.stringify({
              id: message.id,
              error: { code: -32000, message: String((error as Error).message) },
            }),
          );
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
    handle: (method, handler) => void handlers.set(method, handler),
    stall: (method) => void stalled.add(method),
    emit,
    addTarget,
    destroyTarget,
    socketCount: (targetId) => sockets.get(targetId)?.size ?? 0,
    close: async () => {
      for (const set of sockets.values()) for (const socket of set) socket.terminate();
      wss.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}
