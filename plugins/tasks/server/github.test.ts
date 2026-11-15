import { expect, test } from "vitest";
import { createGithub } from "./github.js";

interface Call {
  url: URL;
  headers: Record<string, string>;
  method: string;
  body: unknown;
}

function github(respond: (url: URL) => Response, url = "") {
  const calls: Call[] = [];
  const request: typeof fetch = async (input, init) => {
    const target = new URL(String(input));
    calls.push({
      url: target,
      headers: init?.headers as Record<string, string>,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    return respond(target);
  };
  return { calls, tracker: createGithub({ url, token: "ghp-s3cret", request }) };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const found = (...items: object[]) => json({ total_count: items.length, items });

const ISSUE = {
  number: 7,
  title: "Rate limit the login form",
  body: "  Five tries a minute.\n",
  html_url: "https://github.com/shop/web/issues/7",
  state: "open",
  labels: [{ name: "security" }, "backend"],
  repository_url: "https://api.github.com/repos/shop/web",
  updated_at: "2026-11-14T03:00:00Z",
  comments: 3,
  user: { login: "dimas" },
};
const SHAPED_ISSUE = {
  source: "github",
  kind: "issue",
  id: "issue:shop/web:7",
  key: "shop/web#7",
  title: "Rate limit the login form",
  status: "Open",
  url: "https://github.com/shop/web/issues/7",
  description: "Five tries a minute.",
  details: [["Labels", "security, backend"]],
  branchPrefix: "7",
  updatedAt: "2026-11-14T03:00:00.000Z",
  phase: "todo",
};

test("an empty query lists the open issues assigned to me, newest change first", async () => {
  const { calls, tracker } = github(() => found(ISSUE));
  const issues = await tracker.search("  ");
  expect(calls).toHaveLength(1);
  expect(calls[0].url.origin + calls[0].url.pathname).toBe("https://api.github.com/search/issues");
  expect(Object.fromEntries(calls[0].url.searchParams)).toEqual({
    q: "is:issue is:open assignee:@me",
    sort: "updated",
    order: "desc",
    per_page: "20",
  });
  expect(calls[0].headers.Authorization).toBe("Bearer ghp-s3cret");
  expect(calls[0].headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
  expect(issues).toEqual([SHAPED_ISSUE]);
});

test("the words of a query match the title, and its qualifiers are dropped", async () => {
  const { calls, tracker } = github(() => found());
  await tracker.search(' login "form" is:closed repo:other/one ');
  expect(calls[0].url.searchParams.get("q")).toBe(
    "login form is closed repo other one in:title is:issue is:open assignee:@me",
  );
});

test("github.com answers on its API host, and an Enterprise server under /api/v3", async () => {
  const dotcom = github(() => found(), "https://github.com/");
  await dotcom.tracker.search("");
  expect(dotcom.calls[0].url.origin).toBe("https://api.github.com");
  const enterprise = github(() => found(), "https://ghe.team.test/");
  await enterprise.tracker.search("");
  expect(enterprise.calls[0].url.origin + enterprise.calls[0].url.pathname).toBe(
    "https://ghe.team.test/api/v3/search/issues",
  );
  const plain = github(() => found(), "http://ghe.team.test");
  await expect(plain.tracker.search("")).rejects.toThrow(
    "The GitHub address must start with https://.",
  );
  expect(plain.calls).toEqual([]);
});

test("an issue with no body or labels still lists, and one whose link is no web address is left out", async () => {
  const bare = {
    number: 3,
    title: "Tidy up",
    html_url: "https://github.com/a/b/issues/3",
    repository_url: "https://api.github.com/repos/a/b",
  };
  const { tracker } = github(() => found(bare, { ...bare, number: 4, html_url: "javascript:1" }));
  expect(await tracker.search("")).toEqual([
    {
      source: "github",
      kind: "issue",
      id: "issue:a/b:3",
      key: "a/b#3",
      title: "Tidy up",
      status: "Open",
      url: "https://github.com/a/b/issues/3",
      description: "",
      details: [],
      branchPrefix: "3",
      phase: "todo",
    },
  ]);
});

test("a refusal is an error in words", async () => {
  const { tracker } = github(() => json({ message: "Bad credentials" }, 401));
  await expect(tracker.search("")).rejects.toThrow("GitHub rejected the saved sign-in details.");
});

const PULL_ITEM = {
  number: 12,
  title: "Add the rate limiter",
  body: "Closes #7\n",
  html_url: "https://github.com/shop/web/pull/12",
  state: "open",
  draft: false,
  repository_url: "https://api.github.com/repos/shop/web",
  updated_at: "2026-11-14T04:00:00Z",
  comments: 5,
  user: { login: "dimas" },
  pull_request: { merged_at: null },
};
const SHAPED_PULL = {
  source: "github",
  kind: "mr",
  id: "mr:shop/web:12",
  key: "shop/web#12",
  title: "Add the rate limiter",
  status: "Open",
  url: "https://github.com/shop/web/pull/12",
  description: "Closes #7",
  details: [["Author", "@dimas"]],
  branchPrefix: "12",
  updatedAt: "2026-11-14T04:00:00.000Z",
  phase: "doing",
};

test("pull requests are the open ones that wait for my review, then the ones assigned to me", async () => {
  const mine = {
    ...PULL_ITEM,
    number: 13,
    html_url: "https://github.com/shop/web/pull/13",
    draft: true,
  };
  const { calls, tracker } = github((url) =>
    // #12 is both assigned to me and waiting for my review.
    url.searchParams.get("q")?.includes("review-requested")
      ? found(PULL_ITEM)
      : found(PULL_ITEM, mine),
  );
  const pulls = await tracker.mergeRequests!(" limiter ");
  expect(calls.map((call) => call.url.searchParams.get("q")).toSorted()).toEqual([
    "limiter in:title is:pr is:open assignee:@me",
    "limiter in:title is:pr is:open review-requested:@me",
  ]);
  expect(pulls).toEqual([
    { ...SHAPED_PULL, note: "Review requested" },
    {
      ...SHAPED_PULL,
      id: "mr:shop/web:13",
      key: "shop/web#13",
      url: "https://github.com/shop/web/pull/13",
      status: "Draft",
      branchPrefix: "13",
      note: "Assigned to you",
      phase: "todo",
    },
  ]);
});

const PULL = {
  number: 12,
  title: "Add the rate limiter",
  body: "Closes #7\n",
  html_url: "https://github.com/shop/web/pull/12",
  state: "open",
  draft: false,
  merged: false,
  updated_at: "2026-11-14T04:00:00Z",
  comments: 2,
  user: { login: "dimas" },
  head: { ref: "7-rate-limit" },
  base: { ref: "main" },
  requested_reviewers: [{ login: "rina" }, { login: "bot" }],
};
const COMMENTS = [
  { id: 29, body: "Why 5?", user: { login: "rina" }, created_at: "2026-11-14T04:00:00Z" },
  { id: 31, body: " Fixed.\n", user: { login: "dimas" }, created_at: "2026-11-14T05:00:00Z" },
];

test("a pull request's page reads it and its conversation, and offers no move", async () => {
  const { calls, tracker } = github((url) =>
    url.pathname.endsWith("/comments") ? json(COMMENTS) : json(PULL),
  );
  const detail = await tracker.detail("mr:shop/web:12");
  expect(calls.map((call) => call.url.pathname + call.url.search)).toEqual([
    "/repos/shop/web/pulls/12",
    "/repos/shop/web/issues/12/comments?per_page=20&page=1",
  ]);
  expect(detail).toEqual({
    ...SHAPED_PULL,
    details: [
      ["Branches", "7-rate-limit → main"],
      ["Author", "@dimas"],
      ["Reviewers", "@rina, @bot"],
    ],
    comments: [
      { id: "29", author: "@rina", at: "2026-11-14T04:00:00.000Z", text: "Why 5?" },
      { id: "31", author: "@dimas", at: "2026-11-14T05:00:00.000Z", text: "Fixed." },
    ],
    earlierComments: 0,
    changes: [],
    markdown: true,
  });
});

test("a pull request's state is in words", async () => {
  const stands = async (pull: object) => {
    const { tracker } = github((url) =>
      url.pathname.endsWith("/comments") ? json([]) : json(pull),
    );
    const { status, phase } = await tracker.detail("mr:shop/web:12");
    return [status, phase];
  };
  expect(await stands({ ...PULL, draft: true })).toEqual(["Draft", "todo"]);
  expect(await stands({ ...PULL, state: "closed", merged: true })).toEqual(["Merged", "done"]);
  expect(await stands({ ...PULL, state: "closed" })).toEqual(["Closed", "done"]);
});

test("an issue's page shows its newest 20 comments, read from the end of a long thread", async () => {
  // 45 comments, 20 to a page: the last page holds 5, so the one before it is read too.
  const page = (from: number, count: number) =>
    Array.from({ length: count }, (_, index) => ({
      id: from + index,
      body: `c${from + index}`,
      user: { login: "rina" },
      created_at: "2026-11-14T04:00:00Z",
    }));
  const { calls, tracker } = github((url) => {
    if (!url.pathname.endsWith("/comments")) return json({ ...ISSUE, comments: 45 });
    return url.searchParams.get("page") === "3" ? json(page(41, 5)) : json(page(21, 20));
  });
  const detail = await tracker.detail("issue:shop/web:7");
  expect(calls.map((call) => call.url.pathname + call.url.search).toSorted()).toEqual([
    "/repos/shop/web/issues/7",
    "/repos/shop/web/issues/7/comments?per_page=20&page=2",
    "/repos/shop/web/issues/7/comments?per_page=20&page=3",
  ]);
  expect(detail.comments).toHaveLength(20);
  expect(detail.comments[0].text).toBe("c26");
  expect(detail.comments[19].text).toBe("c45");
  expect(detail.earlierComments).toBe(25);
  expect(detail.changes).toEqual([{ id: "close", label: "Closed" }]);
});

test("an issue with no comments asks for none, and a closed one can be opened again", async () => {
  const { calls, tracker } = github(() => json({ ...ISSUE, comments: 0, state: "closed" }));
  const detail = await tracker.detail("issue:shop/web:7");
  expect(calls).toHaveLength(1);
  expect(detail).toMatchObject({
    status: "Closed",
    phase: "done",
    comments: [],
    earlierComments: 0,
  });
  expect(detail.changes).toEqual([{ id: "reopen", label: "Open" }]);
});

test("a task that is gone, or hidden from the saved account, says so", async () => {
  const { tracker } = github(() => json({ message: "Not Found" }, 404));
  await expect(tracker.detail("issue:shop/web:999")).rejects.toThrow(
    "GitHub has no such task, or the saved account cannot see it.",
  );
});

test("an id that is no task is refused before anything is sent", async () => {
  const { calls, tracker } = github(() => json({}));
  for (const id of [
    "issue:shop:7",
    "mr:shop/web:12/comments",
    "issue:../web:2",
    "issue:shop/..:2",
    "shop/web#7",
    "",
  ]) {
    await expect(tracker.detail(id)).rejects.toThrow("That is no GitHub task.");
    await expect(tracker.find(id)).rejects.toThrow("That is no GitHub task.");
    await expect(tracker.comment(id, "hi")).rejects.toThrow("That is no GitHub task.");
    await expect(tracker.change(id, "close")).rejects.toThrow("That is no GitHub task.");
  }
  expect(calls).toEqual([]);
});

test("a comment is posted as the text that was typed, on a pull request's conversation too", async () => {
  const { calls, tracker } = github(() => json({ id: 32 }, 201));
  await tracker.comment("mr:shop/web:12", "LGTM");
  expect(calls).toHaveLength(1);
  expect(calls[0].method).toBe("POST");
  expect(calls[0].url.href).toBe("https://api.github.com/repos/shop/web/issues/12/comments");
  expect(calls[0].body).toEqual({ body: "LGTM" });
  expect(calls[0].headers.Authorization).toBe("Bearer ghp-s3cret");
});

test("an issue is closed and reopened; a pull request is not", async () => {
  const { calls, tracker } = github(() => json(ISSUE));
  await tracker.change("issue:shop/web:7", "close");
  await tracker.change("issue:shop/web:7", "reopen");
  expect(calls.map((call) => [call.method, call.url.pathname, call.body])).toEqual([
    ["PATCH", "/repos/shop/web/issues/7", { state: "closed" }],
    ["PATCH", "/repos/shop/web/issues/7", { state: "open" }],
  ]);
  await expect(tracker.change("issue:shop/web:7", "merge")).rejects.toThrow(
    "That is no GitHub status change.",
  );
  await expect(tracker.change("mr:shop/web:12", "close")).rejects.toThrow(
    "A pull request is merged or closed on GitHub.",
  );
  expect(calls).toHaveLength(2);
});

test("a refused change carries GitHub's reason, or says the token may not write", async () => {
  const invalid = github(() => json({ message: "Validation Failed" }, 422));
  await expect(invalid.tracker.comment("issue:shop/web:7", " ")).rejects.toThrow(
    "GitHub refused the change: Validation Failed",
  );
  const denied = github(() => json({ message: "Resource not accessible" }, 403));
  await expect(denied.tracker.change("issue:shop/web:7", "close")).rejects.toThrow(
    "GitHub did not allow the change. Check what the saved token may do.",
  );
});

test("the account is the signed-in user", async () => {
  const { calls, tracker } = github(() => json({ login: "rina", name: "Rina Putri" }));
  expect(await tracker.account()).toBe("Rina Putri (@rina)");
  expect(calls[0].url.href).toBe("https://api.github.com/user");
  expect(await github(() => json({ login: "rina", name: null })).tracker.account()).toBe("@rina");
});

test("one task is found by its id, with where it stands; one that is gone is nothing", async () => {
  // The issues API answers for a pull request too, and says so.
  const { calls, tracker } = github((url) =>
    json(url.pathname.endsWith("/12") ? { ...PULL_ITEM, draft: true } : ISSUE),
  );
  expect(await tracker.find("issue:shop/web:7")).toEqual(SHAPED_ISSUE);
  expect(await tracker.find("mr:shop/web:12")).toMatchObject({
    kind: "mr",
    status: "Draft",
    phase: "todo",
  });
  expect(calls.map((call) => call.url.pathname)).toEqual([
    "/repos/shop/web/issues/7",
    "/repos/shop/web/issues/12",
  ]);
  expect(await github(() => json({}, 404)).tracker.find("issue:shop/web:999")).toBeNull();
  await expect(github(() => json({}, 401)).tracker.find("issue:shop/web:7")).rejects.toThrow(
    "GitHub rejected the saved sign-in details.",
  );
});
