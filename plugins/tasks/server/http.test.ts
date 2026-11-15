import { expect, test } from "vitest";
import { z } from "zod";
import { baseUrl, getJson, sendJson } from "./http.js";
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
