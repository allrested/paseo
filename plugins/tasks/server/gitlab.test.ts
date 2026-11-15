import { expect, test } from "vitest";
import { createGitlab } from "./gitlab.js";

interface Call {
  url: URL;
  headers: Record<string, string>;
  method: string;
  body: unknown;
}

function gitlab(respond: (url: URL) => Response, url = "https://git.team.test/") {
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
  return { calls, tracker: createGitlab({ url, token: "glpat-s3cret", request }) };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const USER = { id: 7, username: "rina", name: "Rina Putri" };
/** Answers who is signed in, which a task's page asks, and leaves the rest to `respond`. */
const signedIn = (respond: (url: URL) => Response) => (url: URL) =>
  url.pathname.endsWith("/user") ? json(USER) : respond(url);

const ISSUE = {
  iid: 7,
  project_id: 42,
  state: "opened",
  updated_at: "2026-11-14T03:00:00.000Z",
  user_notes_count: 3,
  title: "Rate limit the login form",
  description: "  Five tries a minute.\n",
  web_url: "https://git.team.test/shop/web/-/issues/7",
  labels: ["security", "backend"],
  references: { short: "#7", relative: "#7", full: "shop/web#7" },
};

test("an empty query lists the open issues assigned to me", async () => {
  const { calls, tracker } = gitlab(() => json([ISSUE]));
  const issues = await tracker.search("");
  expect(calls).toHaveLength(1);
  expect(calls[0].url.origin + calls[0].url.pathname).toBe("https://git.team.test/api/v4/issues");
  expect(Object.fromEntries(calls[0].url.searchParams)).toEqual({
    scope: "assigned_to_me",
    state: "opened",
    order_by: "updated_at",
    per_page: "20",
  });
  expect(calls[0].headers["PRIVATE-TOKEN"]).toBe("glpat-s3cret");
  expect(issues).toEqual([
    {
      source: "gitlab",
      kind: "issue",
      id: "issue:42:7",
      key: "shop/web#7",
      title: "Rate limit the login form",
      status: "Open",
      url: "https://git.team.test/shop/web/-/issues/7",
      description: "Five tries a minute.",
      details: [["Labels", "security, backend"]],
      branchPrefix: "7",
      updatedAt: "2026-11-14T03:00:00.000Z",
      phase: "todo",
    },
  ]);
});

test("a query searches the titles", async () => {
  const { calls, tracker } = gitlab(() => json([]));
  await tracker.search(" login form ");
  expect(calls[0].url.searchParams.get("search")).toBe("login form");
  expect(calls[0].url.searchParams.get("in")).toBe("title");
});

test("an issue with no reference, labels or description still lists", async () => {
  const bare = {
    iid: 3,
    project_id: 9,
    title: "Typo",
    web_url: "https://git.team.test/a/b/-/issues/3",
  };
  const { tracker } = gitlab(() => json([bare]));
  expect(await tracker.search("")).toEqual([
    {
      source: "gitlab",
      kind: "issue",
      id: "issue:9:3",
      key: "#3",
      title: "Typo",
      status: "Open",
      url: "https://git.team.test/a/b/-/issues/3",
      description: "",
      details: [],
      branchPrefix: "3",
      phase: "todo",
    },
  ]);
});

test("an issue whose link is no web address is left out", async () => {
  const { tracker } = gitlab(() => json([{ ...ISSUE, web_url: "javascript:alert(1)" }, ISSUE]));
  expect((await tracker.search("")).map((issue) => issue.url)).toEqual([ISSUE.web_url]);
});

test("the account is the signed-in user", async () => {
  const named = gitlab(
    () => json({ username: "rina", name: "Rina Putri" }),
    "https://host.test/gitlab",
  );
  expect(await named.tracker.account()).toBe("Rina Putri (@rina)");
  expect(named.calls[0].url.href).toBe("https://host.test/gitlab/api/v4/user");
  const bare = gitlab(() => json({ username: "rina" }));
  expect(await bare.tracker.account()).toBe("@rina");
});

test("a refusal is an error in words", async () => {
  const { tracker } = gitlab(() => json({ message: "401 Unauthorized" }, 401));
  await expect(tracker.search("")).rejects.toThrow("GitLab rejected the saved sign-in details.");
});

const MERGE_REQUEST = {
  iid: 12,
  project_id: 42,
  title: "Add the rate limiter",
  description: "Closes #7\n",
  web_url: "https://git.team.test/shop/web/-/merge_requests/12",
  state: "opened",
  draft: false,
  source_branch: "7-rate-limit",
  target_branch: "main",
  references: { full: "shop/web!12" },
  updated_at: "2026-11-14T04:00:00.000Z",
  user_notes_count: 5,
  author: { username: "dimas", name: "Dimas" },
  reviewers: [{ username: "rina", name: "Rina Putri" }, { username: "bot" }],
  has_conflicts: true,
  head_pipeline: { status: "success" },
};
const SHAPED = {
  source: "gitlab",
  kind: "mr",
  id: "mr:42:12",
  key: "shop/web!12",
  title: "Add the rate limiter",
  status: "Open",
  url: "https://git.team.test/shop/web/-/merge_requests/12",
  description: "Closes #7",
  details: [
    ["Branches", "7-rate-limit → main"],
    ["Author", "Dimas"],
    ["Reviewers", "Rina Putri, @bot"],
    ["Pipeline", "passed"],
    ["Conflicts", "Yes"],
  ],
  branchPrefix: "12",
  updatedAt: "2026-11-14T04:00:00.000Z",
  phase: "doing",
};

test("merge requests are the open ones that wait for my review, then the ones assigned to me", async () => {
  const mine = { ...MERGE_REQUEST, iid: 13, references: { full: "shop/web!13" }, draft: true };
  const { calls, tracker } = gitlab((url) => {
    if (url.pathname.endsWith("/user")) return json({ username: "rina", name: "Rina Putri" });
    // !12 is both assigned to me and waiting for my review.
    return json(
      url.searchParams.has("reviewer_username") ? [MERGE_REQUEST] : [MERGE_REQUEST, mine],
    );
  });
  const found = await tracker.mergeRequests!(" limiter ");
  const lists = calls.filter((call) => call.url.pathname === "/api/v4/merge_requests");
  expect(lists.map((call) => Object.fromEntries(call.url.searchParams))).toEqual(
    expect.arrayContaining([
      {
        scope: "all",
        reviewer_username: "rina",
        state: "opened",
        order_by: "updated_at",
        per_page: "20",
        search: "limiter",
        in: "title",
      },
      {
        scope: "assigned_to_me",
        state: "opened",
        order_by: "updated_at",
        per_page: "20",
        search: "limiter",
        in: "title",
      },
    ]),
  );
  expect(lists).toHaveLength(2);
  expect(found).toEqual([
    { ...SHAPED, note: "Review requested" },
    {
      ...SHAPED,
      id: "mr:42:13",
      key: "shop/web!13",
      status: "Draft",
      branchPrefix: "13",
      note: "Assigned to you",
      phase: "todo",
    },
  ]);
});

test("the username is asked once, and asked again after a failure", async () => {
  let fail = true;
  const { calls, tracker } = gitlab((url) => {
    if (!url.pathname.endsWith("/user")) return json([]);
    if (fail) return json({}, 500);
    return json({ username: "rina" });
  });
  await expect(tracker.mergeRequests!("")).rejects.toThrow("GitLab answered HTTP 500.");
  fail = false;
  await tracker.mergeRequests!("");
  await tracker.mergeRequests!("");
  expect(calls.filter((call) => call.url.pathname.endsWith("/user"))).toHaveLength(2);
});

test("a merge request's state is in words", async () => {
  const states = [
    [{ state: "merged" }, "Merged"],
    [{ state: "closed" }, "Closed"],
    [{ state: "opened", draft: true }, "Draft"],
    [{ state: "opened" }, "Open"],
  ] as const;
  for (const [change, status] of states) {
    const { tracker } = gitlab(
      signedIn((url) =>
        url.pathname.endsWith("/notes")
          ? json([])
          : json({ ...MERGE_REQUEST, draft: false, ...change }),
      ),
    );
    expect((await tracker.detail("mr:42:12")).status).toBe(status);
  }
});

const NOTES = [
  // Newest first, as asked.
  {
    id: 31,
    body: "Fixed.\n",
    author: { username: "dimas", name: "Dimas" },
    created_at: "2026-11-14T05:00:00.000Z",
    system: false,
  },
  {
    id: 30,
    body: "added 1 commit",
    author: { username: "dimas" },
    created_at: "2026-11-14T04:59:00.000Z",
    system: true,
  },
  { id: 29, body: "Why 5?", author: { username: "rina" }, created_at: "2026-11-14T04:00:00.000Z" },
];

test("a merge request's page reads it and its comments, without the system notes", async () => {
  const { calls, tracker } = gitlab(
    signedIn((url) => (url.pathname.endsWith("/notes") ? json(NOTES) : json(MERGE_REQUEST))),
  );
  const detail = await tracker.detail("mr:42:12");
  expect(calls.map((call) => call.url.pathname + call.url.search)).toEqual([
    "/api/v4/projects/42/merge_requests/12",
    "/api/v4/projects/42/merge_requests/12/notes?sort=desc&order_by=created_at&per_page=40",
    "/api/v4/user",
  ]);
  expect(detail).toEqual({
    ...SHAPED,
    comments: [
      { id: "29", author: "@rina", at: "2026-11-14T04:00:00.000Z", text: "Why 5?" },
      { id: "31", author: "Dimas", at: "2026-11-14T05:00:00.000Z", text: "Fixed." },
    ],
    earlierComments: 3,
    changes: [],
    markdown: true,
    assignedToMe: false,
    images: [],
  });
});

test("an issue's page offers the one move its state allows", async () => {
  const open = gitlab(
    signedIn((url) => (url.pathname.endsWith("/notes") ? json([]) : json(ISSUE))),
  );
  const detail = await open.tracker.detail("issue:42:7");
  expect(open.calls[0].url.pathname).toBe("/api/v4/projects/42/issues/7");
  expect(detail).toMatchObject({ id: "issue:42:7", status: "Open", earlierComments: 3 });
  expect(detail.changes).toEqual([{ id: "close", label: "Closed" }]);

  const closed = gitlab(
    signedIn((url) =>
      url.pathname.endsWith("/notes") ? json([]) : json({ ...ISSUE, state: "closed" }),
    ),
  );
  expect(await closed.tracker.detail("issue:42:7")).toMatchObject({
    status: "Closed",
    changes: [{ id: "reopen", label: "Open" }],
  });
});

test("a task that is gone, or hidden from the saved account, says so", async () => {
  const { tracker } = gitlab(() => json({ message: "404 Not found" }, 404));
  await expect(tracker.detail("issue:42:999")).rejects.toThrow(
    "GitLab has no such task, or the saved account cannot see it.",
  );
});

test("an id that is no task is refused before anything is sent", async () => {
  const { calls, tracker } = gitlab(() => json({}));
  for (const id of ["issue:42", "mr:42:12/notes", "issue:../1:2", "group/project#7", ""]) {
    await expect(tracker.detail(id)).rejects.toThrow("That is no GitLab task.");
    await expect(tracker.comment(id, "hi")).rejects.toThrow("That is no GitLab task.");
    await expect(tracker.change(id, "close")).rejects.toThrow("That is no GitLab task.");
  }
  expect(calls).toEqual([]);
});

test("a comment is posted as the text that was typed", async () => {
  const { calls, tracker } = gitlab(() => json({ id: 32 }, 201));
  await tracker.comment("mr:42:12", "LGTM");
  expect(calls).toHaveLength(1);
  expect(calls[0].method).toBe("POST");
  expect(calls[0].url.href).toBe(
    "https://git.team.test/api/v4/projects/42/merge_requests/12/notes",
  );
  expect(calls[0].body).toEqual({ body: "LGTM" });
  expect(calls[0].headers["PRIVATE-TOKEN"]).toBe("glpat-s3cret");
});

test("an issue is closed and reopened; a merge request is not", async () => {
  const { calls, tracker } = gitlab(() => json(ISSUE));
  await tracker.change("issue:42:7", "close");
  await tracker.change("issue:42:7", "reopen");
  expect(calls.map((call) => [call.method, call.url.pathname, call.body])).toEqual([
    ["PUT", "/api/v4/projects/42/issues/7", { state_event: "close" }],
    ["PUT", "/api/v4/projects/42/issues/7", { state_event: "reopen" }],
  ]);
  await expect(tracker.change("issue:42:7", "merge")).rejects.toThrow(
    "That is no GitLab status change.",
  );
  await expect(tracker.change("mr:42:12", "close")).rejects.toThrow(
    "A merge request is merged or closed on GitLab.",
  );
  expect(calls).toHaveLength(2);
});

test("a refused change carries GitLab's reason, or says the token may not write", async () => {
  const invalid = gitlab(() => json({ message: { body: ["can't be blank"] } }, 400));
  await expect(invalid.tracker.comment("issue:42:7", " ")).rejects.toThrow(
    'GitLab refused the change: {"body":["can\'t be blank"]}',
  );
  const scope = gitlab(() => json({ error: "insufficient_scope" }, 403));
  await expect(scope.tracker.comment("issue:42:7", "hi")).rejects.toThrow(
    "GitLab did not allow the change. Check what the saved token may do.",
  );
});

test("one task is found by its id, with where it stands", async () => {
  const { calls, tracker } = gitlab((url) =>
    json(url.pathname.includes("/merge_requests/") ? { ...MERGE_REQUEST, draft: true } : ISSUE),
  );
  expect(await tracker.find("issue:42:7")).toMatchObject({
    id: "issue:42:7",
    status: "Open",
    phase: "todo",
  });
  expect(await tracker.find("mr:42:12")).toMatchObject({ status: "Draft", phase: "todo" });
  expect(calls.map((call) => call.url.pathname)).toEqual([
    "/api/v4/projects/42/issues/7",
    "/api/v4/projects/42/merge_requests/12",
  ]);
  const closed = gitlab(() => json({ ...ISSUE, state: "closed" }));
  expect((await closed.tracker.find("issue:42:7"))?.phase).toBe("done");
  const open = gitlab(() => json(MERGE_REQUEST));
  expect((await open.tracker.find("mr:42:12"))?.phase).toBe("doing");
});

test("a task that is gone is found as nothing; a refusal is an error; a bad id is refused", async () => {
  expect(await gitlab(() => json({}, 404)).tracker.find("issue:42:999")).toBeNull();
  await expect(gitlab(() => json({}, 401)).tracker.find("issue:42:7")).rejects.toThrow(
    "GitLab rejected the saved sign-in details.",
  );
  const { calls, tracker } = gitlab(() => json(ISSUE));
  await expect(tracker.find("issue:shop/web:7")).rejects.toThrow("That is no GitLab task.");
  expect(calls).toEqual([]);
});

test("a task's page says whose the task is, and takes the uploads out of its description", async () => {
  const issue = {
    ...ISSUE,
    description:
      "Before:\n\n![screen shot](/uploads/0123456789abcdef0123456789abcdef/before.png){width=300}\n\n" +
      "After: ![image](/uploads/fedcba9876543210fedcba9876543210/after%20fix.png) and " +
      "![logo](https://cdn.team.test/logo.png)",
    assignees: [
      { id: 7, username: "rina", name: "Rina Putri" },
      { id: 9, username: "dimas" },
    ],
  };
  const { tracker } = gitlab(
    signedIn((url) => (url.pathname.endsWith("/notes") ? json([]) : json(issue))),
  );
  const detail = await tracker.detail("issue:42:7");
  expect(detail.assignedToMe).toBe(true);
  expect(detail.details).toContainEqual(["Assignee", "Rina Putri, @dimas"]);
  expect(detail.images).toEqual([
    { id: "0123456789abcdef0123456789abcdef/before.png", name: "screen shot" },
    { id: "fedcba9876543210fedcba9876543210/after%20fix.png", name: "after%20fix.png" },
  ]);
  // A picture from elsewhere is the Markdown's own to show.
  expect(detail.description).toBe(
    "Before:\n\n(image: screen shot)\n\nAfter: (image: after%20fix.png) and ![logo](https://cdn.team.test/logo.png)",
  );
  const theirs = gitlab(
    signedIn((url) =>
      url.pathname.endsWith("/notes")
        ? json([])
        : json({ ...ISSUE, assignees: [{ id: 9, username: "dimas" }] }),
    ),
  );
  expect(await theirs.tracker.detail("issue:42:7")).toMatchObject({
    assignedToMe: false,
    images: [],
  });
});

test("the projects an issue can go to are the ones I am a member of, newest activity first", async () => {
  const { calls, tracker } = gitlab(() =>
    json([
      { id: 42, path_with_namespace: "shop/web" },
      { id: 43, path_with_namespace: "shop/api" },
    ]),
  );
  expect(await tracker.places(" shop ")).toEqual([
    { id: "42", label: "shop/web" },
    { id: "43", label: "shop/api" },
  ]);
  expect(calls[0].url.pathname).toBe("/api/v4/projects");
  expect(Object.fromEntries(calls[0].url.searchParams)).toEqual({
    membership: "true",
    simple: "true",
    order_by: "last_activity_at",
    per_page: "20",
    search: "shop",
  });
  expect(tracker.kinds).toBeUndefined();
});

test("an issue is made in a project, and its id is the one its page is asked by", async () => {
  const { calls, tracker } = gitlab(() => json({ iid: 9, project_id: 42 }, 201));
  const id = await tracker.create({ place: "42", title: "Cache it", description: "Soon." });
  expect(id).toBe("issue:42:9");
  expect(calls.map((call) => [call.method, call.url.pathname, call.body])).toEqual([
    ["POST", "/api/v4/projects/42/issues", { title: "Cache it", description: "Soon." }],
  ]);
  await expect(tracker.create({ place: "shop/web", title: "t", description: "" })).rejects.toThrow(
    "That is no GitLab project.",
  );
  expect(calls).toHaveLength(1);
});

test("assigning a task to me keeps who has it, with me first", async () => {
  const { calls, tracker } = gitlab(
    signedIn(() => json({ ...ISSUE, assignees: [{ id: 9, username: "dimas" }, USER] })),
  );
  await tracker.assign("issue:42:7");
  const sent = calls.filter((call) => call.method === "PUT");
  expect(sent.map((call) => [call.url.pathname, call.body])).toEqual([
    ["/api/v4/projects/42/issues/7", { assignee_ids: [7, 9] }],
  ]);
  const request = gitlab(signedIn(() => json(MERGE_REQUEST)));
  await request.tracker.assign("mr:42:12");
  expect(request.calls.at(-1)?.body).toEqual({ assignee_ids: [7] });
  expect(request.calls.at(-1)?.url.pathname).toBe("/api/v4/projects/42/merge_requests/12");
});

test("a picture is read through the project's uploads, which the API serves from 17.4", async () => {
  const png = new Uint8Array([137, 80, 78, 71]);
  const { calls, tracker } = gitlab(
    () => new Response(png, { headers: { "Content-Type": "image/png" } }),
  );
  const image = await tracker.image("issue:42:7", "0123456789abcdef0123456789abcdef/before.png");
  expect(image.mime).toBe("image/png");
  expect(calls[0].url.pathname).toBe(
    "/api/v4/projects/42/uploads/0123456789abcdef0123456789abcdef/before.png",
  );
  expect(calls[0].headers["PRIVATE-TOKEN"]).toBe("glpat-s3cret");
  for (const bad of ["../../user", "0123456789abcdef0123456789abcdef/a/b.png", "short/a.png"]) {
    await expect(tracker.image("issue:42:7", bad)).rejects.toThrow("That is no GitLab upload.");
  }
  expect(calls).toHaveLength(1);
  const old = gitlab(() => json({ message: "404 Not Found" }, 404));
  await expect(
    old.tracker.image("issue:42:7", "0123456789abcdef0123456789abcdef/before.png"),
  ).rejects.toThrow(
    "GitLab has no such upload here, or is older than 17.4 and cannot hand it out.",
  );
});
