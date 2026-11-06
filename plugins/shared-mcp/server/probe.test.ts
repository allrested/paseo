import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { probeMcp } from "./probe.js";

interface RecordedRequest {
  method: string | undefined;
  url: string | undefined;
  accept: string | undefined;
  contentType: string | undefined;
  authorization: string | undefined;
  sessionId: string | undefined;
  body: unknown;
}

interface TestServer {
  port: number;
  requests: RecordedRequest[];
}

type Respond = (request: RecordedRequest, res: ServerResponse) => void;

const SESSION_ID = "probe-session-1";

const INITIALIZE_BODY = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "paseo-shared-mcp-probe", version: "1.0.0" },
  },
};

const servers: Server[] = [];

// The probe runs inside the daemon, where either of these ends the process.
const strays: unknown[] = [];

function recordStray(error: unknown): void {
  strays.push(error);
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return typeof value === "string" ? value : undefined;
}

async function recordRequest(req: IncomingMessage): Promise<RecordedRequest> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  const body: unknown = text === "" ? null : JSON.parse(text);
  return {
    method: req.method,
    url: req.url,
    accept: header(req, "accept"),
    contentType: header(req, "content-type"),
    authorization: header(req, "authorization"),
    sessionId: header(req, "mcp-session-id"),
    body,
  };
}

async function listen(server: Server, port: number): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("expected a TCP address");
  return address.port;
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

async function startServer(respond: Respond): Promise<TestServer> {
  const requests: RecordedRequest[] = [];
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let request: RecordedRequest;
    try {
      request = await recordRequest(req);
    } catch {
      // The probe gave up before its body arrived: record nothing.
      res.destroy();
      return;
    }
    requests.push(request);
    respond(request, res);
  }
  const server = createServer((req, res) => {
    void handle(req, res);
  });
  servers.push(server);
  return { port: await listen(server, 0), requests };
}

// Bound once to learn a free port number, then released, so nothing listens on it.
async function closedPort(): Promise<number> {
  const server = createServer();
  const port = await listen(server, 0);
  await closeServer(server);
  return port;
}

function respondWith(status: number): Respond {
  return (_request, res) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end("{}");
  };
}

// Answers like a streamable-HTTP server: initialize opens a session and an SSE stream that
// stays open. The DELETE that closes the session gets answerDelete.
function withSession(answerDelete: Respond): Respond {
  return (request, res) => {
    if (request.method === "DELETE") {
      answerDelete(request, res);
      return;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream", "mcp-session-id": SESSION_ID });
    res.write('event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{}}\n\n');
  };
}

// Closes the connection without an answer.
function dropConnection(_request: RecordedRequest, res: ServerResponse): void {
  res.destroy();
}

// Holds every request open, so only the probe's own timeout ends it.
function neverAnswer(): void {}

function initializeRequest(authorization?: string): RecordedRequest {
  return {
    method: "POST",
    url: "/mcp",
    accept: "application/json, text/event-stream",
    contentType: "application/json",
    authorization,
    sessionId: undefined,
    body: INITIALIZE_BODY,
  };
}

// node:http sends no Accept or Content-Type on a DELETE without a body.
function deleteRequest(authorization?: string): RecordedRequest {
  return {
    method: "DELETE",
    url: "/mcp",
    accept: undefined,
    contentType: undefined,
    authorization,
    sessionId: SESSION_ID,
    body: null,
  };
}

describe("probeMcp", () => {
  beforeEach(() => {
    strays.length = 0;
    process.on("unhandledRejection", recordStray);
    process.on("uncaughtException", recordStray);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    const started = servers.splice(0);
    await Promise.all(started.map(closeServer));
    // Late socket events and rejections from an abandoned request surface within a few ticks.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 20);
    });
    process.off("unhandledRejection", recordStray);
    process.off("uncaughtException", recordStray);
    expect(strays).toEqual([]);
  });

  it("deletes the session an initialize opened, without reading its stream", async () => {
    const server = await startServer(withSession(respondWith(200)));

    const result = await probeMcp({ port: server.port, healthPath: "/mcp" });

    expect(result).toEqual({ ok: true, status: 200 });
    expect(server.requests).toEqual([initializeRequest(), deleteRequest()]);
  });

  it("sends the bearer token on the initialize and on the session DELETE", async () => {
    const server = await startServer(withSession(respondWith(200)));

    const result = await probeMcp({
      port: server.port,
      healthPath: "/mcp",
      bearerToken: "probe-token",
    });

    expect(result).toEqual({ ok: true, status: 200 });
    expect(server.requests).toEqual([
      initializeRequest("Bearer probe-token"),
      deleteRequest("Bearer probe-token"),
    ]);
  });

  it.each([401, 403])("counts HTTP %i as alive with no session to delete", async (status) => {
    const server = await startServer(respondWith(status));

    const result = await probeMcp({ port: server.port, healthPath: "/mcp" });

    expect(result).toEqual({ ok: true, status });
    expect(server.requests).toEqual([initializeRequest()]);
  });

  it.each([404, 500])("reports HTTP %i as down", async (status) => {
    const server = await startServer(respondWith(status));

    const result = await probeMcp({ port: server.port, healthPath: "/mcp" });

    expect(result).toEqual({ ok: false, error: `HTTP ${status}` });
    expect(server.requests).toEqual([initializeRequest()]);
  });

  it("reports a refused connection with the socket error", async () => {
    const port = await closedPort();

    const result = await probeMcp({ port, healthPath: "/mcp" });

    expect(result).toEqual({ ok: false, error: `connect ECONNREFUSED 127.0.0.1:${port}` });
  });

  it("gives up on a server that never answers once timeoutMs passes", async () => {
    const server = await startServer(neverAnswer);

    const result = await probeMcp({ port: server.port, healthPath: "/mcp" }, { timeoutMs: 500 });

    expect(result).toEqual({ ok: false, error: "timed out after 500 ms" });
    expect(server.requests).toEqual([initializeRequest()]);
  });

  it("ignores a DELETE the server refuses with 405", async () => {
    const server = await startServer(withSession(respondWith(405)));

    const result = await probeMcp({ port: server.port, healthPath: "/mcp" });

    expect(result).toEqual({ ok: true, status: 200 });
    expect(server.requests).toEqual([initializeRequest(), deleteRequest()]);
  });

  it("ignores a DELETE whose connection drops", async () => {
    const server = await startServer(withSession(dropConnection));

    const result = await probeMcp({ port: server.port, healthPath: "/mcp" });

    expect(result).toEqual({ ok: true, status: 200 });
    expect(server.requests).toEqual([initializeRequest(), deleteRequest()]);
  });

  it("gives up on a DELETE that never answers once timeoutMs passes", async () => {
    const server = await startServer(withSession(neverAnswer));

    const result = await probeMcp({ port: server.port, healthPath: "/mcp" }, { timeoutMs: 500 });

    expect(result).toEqual({ ok: true, status: 200 });
    expect(server.requests).toEqual([initializeRequest(), deleteRequest()]);
  });

  it("reports a healthPath node:http rejects as a result, not a throw", async () => {
    const server = await startServer(respondWith(200));

    const result = await probeMcp({ port: server.port, healthPath: "/m cp" });

    expect(result).toEqual({ ok: false, error: "Request path contains unescaped characters" });
    expect(server.requests).toEqual([]);
  });

  // undici's fetch refuses the Fetch spec's "bad ports" (10080, 6000 and more) with "bad port",
  // and a port-0 bind never lands on one, so the guard watches for the call instead.
  it("probes through node:http, not through fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const server = await startServer(withSession(respondWith(200)));

    const result = await probeMcp({ port: server.port, healthPath: "/mcp" });

    expect(result).toEqual({ ok: true, status: 200 });
    expect(server.requests).toEqual([initializeRequest(), deleteRequest()]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
