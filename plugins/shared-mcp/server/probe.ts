import { request, type IncomingHttpHeaders, type OutgoingHttpHeaders } from "node:http";

export interface ProbeTarget {
  port: number;
  healthPath: string;
  bearerToken?: string;
}

export type ProbeResult = { ok: true; status: number } | { ok: false; error: string };

export interface ProbeOptions {
  timeoutMs?: number;
}

interface ProbeRequest {
  port: number;
  path: string;
  auth: OutgoingHttpHeaders;
  timeoutMs: number;
}

interface ProbeCall {
  method: "POST" | "DELETE";
  headers: OutgoingHttpHeaders;
  body?: string;
}

interface ProbeAnswer {
  status: number;
  sessionId: string | undefined;
}

const DEFAULT_TIMEOUT_MS = 5_000;

// initialize is the one request every MCP server must answer, so the probe needs no
// per-server knowledge. 2025-03-26 is the first protocol version with streamable HTTP; a
// server on a newer version negotiates instead of refusing it.
const INITIALIZE: ProbeCall = {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "paseo-shared-mcp-probe", version: "1.0.0" },
    },
  }),
};

// The probe runs inside the daemon, where an unhandled rejection exits the process, so every
// failure comes back as { ok: false } instead of a throw.
export async function probeMcp(
  target: ProbeTarget,
  options: ProbeOptions = {},
): Promise<ProbeResult> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const probe: ProbeRequest = {
    port: target.port,
    path: target.healthPath,
    auth: authHeader(target.bearerToken),
    timeoutMs,
  };
  let answer: ProbeAnswer;
  try {
    answer = await send(probe, INITIALIZE);
  } catch (error) {
    return { ok: false, error: describeError(error, timeoutMs) };
  }
  if (answer.sessionId) await closeSession(probe, answer.sessionId);
  if (isAlive(answer.status)) return { ok: true, status: answer.status };
  return { ok: false, error: `HTTP ${answer.status}` };
}

// The initialize and the session DELETE both carry it: mcp-gitlab answers 401 to either
// without the bearer.
function authHeader(bearerToken: string | undefined): OutgoingHttpHeaders {
  if (!bearerToken) return {};
  return { Authorization: `Bearer ${bearerToken}` };
}

// node:http, not fetch: undici's fetch refuses the Fetch spec's "bad ports" (6000, 10080 and
// more) with "bad port", and a definition may use any port. Only the status and the session id
// matter, and an SSE answer can stay open, so the socket is destroyed once the headers arrive.
function send(probe: ProbeRequest, call: ProbeCall): Promise<ProbeAnswer> {
  return new Promise<ProbeAnswer>((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port: probe.port,
        path: probe.path,
        method: call.method,
        headers: { ...probe.auth, ...call.headers },
        signal: AbortSignal.timeout(probe.timeoutMs),
      },
      (res) => {
        // Node always sets statusCode on a client response; the fallback only satisfies the type.
        resolve({ status: res.statusCode ?? 502, sessionId: sessionIdOf(res.headers) });
        req.destroy();
      },
    );
    req.on("error", reject);
    req.end(call.body);
  });
}

function sessionIdOf(headers: IncomingHttpHeaders): string | undefined {
  const value = headers["mcp-session-id"];
  return typeof value === "string" ? value : undefined;
}

// Serena's python mcp 1.x keeps an undeleted session until the server exits, so each probe
// closes the session it opened. The DELETE is best effort: the initialize already proved the
// server alive, and a failed DELETE only leaves one session behind.
async function closeSession(probe: ProbeRequest, sessionId: string): Promise<void> {
  try {
    await send(probe, { method: "DELETE", headers: { "mcp-session-id": sessionId } });
  } catch {
    // A refused, dropped or timed-out DELETE changes nothing, like any status it answers with.
  }
}

// Below 500 the server is listening: mcp-gitlab answers 401 without its bearer, playwright-mcp
// 403 to a Host it does not allow, the Python servers 406 or 421 to a request they reject, and
// a rate-limited server 429. A 404 means a wrong healthPath or another service on the port.
function isAlive(status: number): boolean {
  return status < 500 && status !== 404;
}

function describeError(error: unknown, timeoutMs: number): string {
  if (!(error instanceof Error)) return String(error);
  // The request's only abort signal is its timeout.
  if (error.name === "AbortError") return `timed out after ${timeoutMs} ms`;
  return error.message;
}
