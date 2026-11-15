import { expect, test } from "vitest";
import { z } from "zod";
import { baseUrl, getBytes, getJson, sendForJson, sendJson } from "./http.js";
import { TrackerError } from "./issue.js";

const schema = z.object({ ok: z.boolean() });

function answer(body: string, status = 200): typeof fetch {
  return async () => new Response(status === 204 ? null : body, { status });
}

function get(request: typeof fetch) {
  return getJson({ request, name: "Jira", url: "https://x.test/api", headers: {}, schema });
}

test("an address keeps its path and loses trailing slashes", () => {
  expect(baseUrl(" https://team.atlassian.net/ ", "Jira")).toBe("https://team.atlassian.net");
  expect(baseUrl("https://host.test/gitlab//", "GitLab")).toBe("https://host.test/gitlab");
});

test("an address must be https, except on this machine", () => {
  expect(() => baseUrl("http://host.test", "GitLab")).toThrow(
    "The GitLab address must start with https://.",
  );
  expect(() => baseUrl("ftp://host.test", "GitLab")).toThrow(TrackerError);
  expect(baseUrl("http://127.0.0.1:8080", "GitLab")).toBe("http://127.0.0.1:8080");
  expect(baseUrl("http://localhost:8080/", "GitLab")).toBe("http://localhost:8080");
});

test("an address that is no web address is refused", () => {
  expect(() => baseUrl("team.atlassian.net", "Jira")).toThrow(
    "The Jira address is not a web address.",
  );
});

test("asks for JSON with the given headers and follows no redirect", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const request: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response('{"ok":true}');
  };
  const body = await getJson({
    request,
    name: "Jira",
    url: "https://x.test/api",
    headers: { Authorization: "Basic abc" },
    schema,
  });
  expect(body).toEqual({ ok: true });
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe("https://x.test/api");
  expect(calls[0].init.headers).toEqual({ Authorization: "Basic abc", Accept: "application/json" });
  expect(calls[0].init.redirect).toBe("manual");
  expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
});

test.each([
  [302, "Jira answered with a redirect. Check the address."],
  [401, "Jira rejected the saved sign-in details."],
  [403, "Jira rejected the saved sign-in details."],
  [404, "Jira has no API at this address."],
  [429, "Jira is limiting requests. Try again shortly."],
  [500, "Jira answered HTTP 500."],
])("HTTP %i becomes a sentence and keeps the status", async (status, message) => {
  const error = await get(answer("{}", status)).catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(TrackerError);
  expect(error).toMatchObject({ message, status });
});

test("an answer that is not JSON, or not the expected shape, is refused", async () => {
  await expect(get(answer("<html>Sign in</html>"))).rejects.toThrow(
    "Jira did not answer with JSON. Check the address.",
  );
  await expect(get(answer('{"ok":"yes"}'))).rejects.toThrow(
    "Jira answered in a shape Paseo does not know.",
  );
});

test("a network failure names its code, and a timeout its length", async () => {
  const refused: typeof fetch = async () => {
    throw new TypeError("fetch failed", {
      cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
    });
  };
  await expect(get(refused)).rejects.toThrow("Could not reach Jira: ECONNREFUSED.");
  const slow: typeof fetch = async () => {
    throw new DOMException("The operation timed out", "TimeoutError");
  };
  await expect(get(slow)).rejects.toThrow("Could not reach Jira: no answer in 10 s.");
});

function send(request: typeof fetch, missing?: string) {
  return sendJson({
    request,
    name: "Jira",
    method: "POST",
    url: "https://x.test/api/comment",
    headers: { Authorization: "Basic abc" },
    body: { body: "hello" },
    reason: (body) => (body as { why?: string }).why ?? null,
    missing,
  });
}

test("a change is sent as JSON, follows no redirect, and its answer is not read", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const request: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(null, { status: 204 });
  };
  await expect(send(request)).resolves.toBeUndefined();
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe("https://x.test/api/comment");
  expect(calls[0].init.method).toBe("POST");
  expect(calls[0].init.body).toBe('{"body":"hello"}');
  expect(calls[0].init.headers).toEqual({
    Authorization: "Basic abc",
    Accept: "application/json",
    "Content-Type": "application/json",
  });
  expect(calls[0].init.redirect).toBe("manual");
  expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
});

test("a refused change says why in the tracker's words, on one line and cut", async () => {
  const error = await send(answer('{"why":"The  status\\n is final."}', 400)).catch(
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(TrackerError);
  expect(error).toMatchObject({
    message: "Jira refused the change: The status is final.",
    status: 400,
  });
  await expect(send(answer(JSON.stringify({ why: "x".repeat(400) }), 422))).rejects.toThrow(
    `Jira refused the change: ${"x".repeat(300)}`,
  );
});

test("a refused change without words, or with a body that is no JSON, names its status", async () => {
  await expect(send(answer("{}", 409))).rejects.toThrow("Jira refused the change (HTTP 409).");
  await expect(send(answer("<html>", 400))).rejects.toThrow("Jira refused the change (HTTP 400).");
});

test.each([
  [401, "Jira rejected the saved sign-in details."],
  [403, "Jira did not allow the change. Check what the saved token may do."],
  [404, "Jira has no such issue."],
  [429, "Jira is limiting requests. Try again shortly."],
  [500, "Jira answered HTTP 500."],
])("a change answered HTTP %i becomes a sentence", async (status, message) => {
  const error = await send(answer('{"why":"ignored"}', status), "Jira has no such issue.").catch(
    (reason: unknown) => reason,
  );
  expect(error).toMatchObject({ message, status });
});

test("a read can say what a 404 means", async () => {
  const request = answer("{}", 404);
  await expect(
    getJson({
      request,
      name: "Jira",
      url: "https://x.test",
      headers: {},
      schema,
      missing: "Gone.",
    }),
  ).rejects.toThrow("Gone.");
});

test("a change that cannot be sent names the network failure", async () => {
  const refused: typeof fetch = async () => {
    throw new TypeError("fetch failed", {
      cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
    });
  };
  await expect(send(refused)).rejects.toThrow("Could not reach Jira: ECONNREFUSED.");
});

test("a change can be read back: the tracker's answer to it, in the shape asked for", async () => {
  const calls: RequestInit[] = [];
  const request: typeof fetch = async (_url, init) => {
    calls.push(init ?? {});
    return new Response('{"ok":true}', { status: 201 });
  };
  const made = await sendForJson({
    request,
    name: "Jira",
    method: "POST",
    url: "https://x.test/api",
    headers: {},
    body: { a: 1 },
    reason: () => null,
    schema,
  });
  expect(made).toEqual({ ok: true });
  expect(calls[0].body).toBe('{"a":1}');
  const refused = sendForJson({
    request: answer('{"why":"no"}', 400),
    name: "Jira",
    method: "POST",
    url: "https://x.test/api",
    headers: {},
    body: {},
    reason: (body) => (body as { why: string }).why,
    schema,
  });
  await expect(refused).rejects.toThrow("Jira refused the change: no");
});

const PNG = new Uint8Array([137, 80, 78, 71]);

function file(body: Uint8Array, type: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": type } });
}

function read(request: typeof fetch, maxBytes = 100) {
  return getBytes({
    request,
    name: "GitLab",
    url: "https://x.test/file.png",
    headers: { "PRIVATE-TOKEN": "s3cret" },
    maxBytes,
  });
}

test("a file is read with the sign-in headers, and comes with its type", async () => {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const request: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), headers: init?.headers as Record<string, string> });
    return file(PNG, "image/png; charset=binary");
  };
  const got = await read(request);
  expect(got.mime).toBe("image/png");
  expect([...got.data]).toEqual([...PNG]);
  expect(calls).toEqual([
    { url: "https://x.test/file.png", headers: { "PRIVATE-TOKEN": "s3cret" } },
  ]);
});

test("a redirect to a signed link is followed once, and the sign-in does not go with it", async () => {
  const calls: Array<{ url: string; headers: unknown }> = [];
  const request: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), headers: init?.headers });
    if (String(url).startsWith("https://x.test/")) {
      return new Response(null, { status: 302, headers: { Location: "https://cdn.test/f?sig=1" } });
    }
    return file(PNG, "image/png");
  };
  expect((await read(request)).mime).toBe("image/png");
  expect(calls).toEqual([
    { url: "https://x.test/file.png", headers: { "PRIVATE-TOKEN": "s3cret" } },
    { url: "https://cdn.test/f?sig=1", headers: {} },
  ]);
});

test("a redirect that is not https, or a second one, is not followed", async () => {
  const plain: typeof fetch = async () =>
    new Response(null, { status: 302, headers: { Location: "http://cdn.test/f" } });
  await expect(read(plain)).rejects.toThrow(
    "GitLab sent the file to an address Paseo will not open.",
  );
  const loop: typeof fetch = async () =>
    new Response(null, { status: 302, headers: { Location: "https://cdn.test/f" } });
  await expect(read(loop)).rejects.toThrow("GitLab answered with a redirect. Check the address.");
});

test("only a tracker on this machine may send the file to this machine", async () => {
  const here: typeof fetch = async (url) =>
    String(url).includes("/file.png")
      ? new Response(null, { status: 302, headers: { Location: "http://127.0.0.1:9/f.png" } })
      : file(PNG, "image/png");
  await expect(read(here)).rejects.toThrow(
    "GitLab sent the file to an address Paseo will not open.",
  );
  const local = await getBytes({
    request: here,
    name: "GitLab",
    url: "http://localhost:8080/file.png",
    headers: {},
    maxBytes: 100,
  });
  expect(local.mime).toBe("image/png");
});

test("a body that turns out longer than it may be is dropped before it is all read", async () => {
  let sent = 0;
  const endless = new ReadableStream<Uint8Array>({
    pull(controller) {
      sent += 1;
      controller.enqueue(new Uint8Array(60));
    },
  });
  const request: typeof fetch = async () =>
    new Response(endless, { headers: { "Content-Type": "image/png" } });
  await expect(read(request)).rejects.toThrow("The image is too large to show here.");
  expect(sent).toBeLessThan(5);
  const empty = await read(
    async () => new Response(null, { headers: { "Content-Type": "image/png" } }),
  );
  expect(empty.data.byteLength).toBe(0);
});

test("a file that is no image, or too large, is refused", async () => {
  await expect(read(async () => file(PNG, "text/html"))).rejects.toThrow(
    "GitLab did not answer with an image.",
  );
  await expect(read(async () => file(new Uint8Array(101), "image/png"))).rejects.toThrow(
    "The image is too large to show here.",
  );
  const told: typeof fetch = async () =>
    new Response(PNG, { headers: { "Content-Type": "image/png", "Content-Length": "5000" } });
  await expect(read(told)).rejects.toThrow("The image is too large to show here.");
});

test("a file read that is refused, or cannot be sent, says so like any read", async () => {
  await expect(read(async () => new Response(null, { status: 404 }))).rejects.toThrow(
    "GitLab has no API at this address.",
  );
  const down: typeof fetch = async () => {
    throw new TypeError("fetch failed", {
      cause: Object.assign(new Error("x"), { code: "ECONNREFUSED" }),
    });
  };
  await expect(read(down)).rejects.toThrow("Could not reach GitLab: ECONNREFUSED.");
});
