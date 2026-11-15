import { expect, test } from "vitest";
import { TrackerError } from "./issue.js";
import { createJira, statusChanges } from "./jira.js";

interface Call {
  url: URL;
  headers: Record<string, string>;
  method: string;
  body: unknown;
}

function jira(respond: (url: URL) => Response, site = "https://team.atlassian.net/") {
  const calls: Call[] = [];
  const request: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({
      url,
      headers: init?.headers as Record<string, string>,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    return respond(url);
  };
  return { calls, tracker: createJira({ site, email: "me@team.test", token: "s3cret", request }) };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const ISSUE = {
  key: "BWLT-12",
  fields: {
    summary: "Add the webhook",
    status: { name: "In Progress" },
    issuetype: { name: "Story" },
    priority: { name: "High" },
    updated: "2026-11-14T10:22:33.123+0800",
    description: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Send it on payment." }] }],
    },
  },
};

test("an empty query lists my open issues, newest change first", async () => {
  const { calls, tracker } = jira(() => json({ issues: [ISSUE] }));
  const issues = await tracker.search("  ");
  expect(calls).toHaveLength(1);
  expect(calls[0].url.origin + calls[0].url.pathname).toBe(
    "https://team.atlassian.net/rest/api/3/search/jql",
  );
  expect(Object.fromEntries(calls[0].url.searchParams)).toEqual({
    jql: "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC",
    maxResults: "20",
    fields: "summary,status,description,issuetype,priority,updated",
  });
  expect(calls[0].headers.Authorization).toBe(
    `Basic ${Buffer.from("me@team.test:s3cret").toString("base64")}`,
  );
  expect(issues).toEqual([
    {
      source: "jira",
      kind: "issue",
      id: "BWLT-12",
      key: "BWLT-12",
      title: "Add the webhook",
      status: "In Progress",
      url: "https://team.atlassian.net/browse/BWLT-12",
      description: "Send it on payment.",
      details: [
        ["Type", "Story"],
        ["Priority", "High"],
      ],
      branchPrefix: "BWLT-12",
      // Jira writes +0800; a client's Date may not read that.
      updatedAt: "2026-11-14T02:22:33.123Z",
    },
  ]);
});

test("the words of a query match the summary, and its operators are dropped", async () => {
  const { calls, tracker } = jira(() => json({ issues: [] }));
  await tracker.search('web-hook" OR project = OPS ~*');
  expect(calls[0].url.searchParams.get("jql")).toBe(
    'assignee = currentUser() AND statusCategory != Done AND summary ~ "web hook OR project OPS*" ORDER BY updated DESC',
  );
});

test("an issue with no summary, status or description still lists", async () => {
  const { tracker } = jira(() => json({ issues: [{ key: "AB-1", fields: {} }] }));
  expect(await tracker.search("")).toEqual([
    {
      source: "jira",
      kind: "issue",
      id: "AB-1",
      key: "AB-1",
      title: "",
      status: "Unknown",
      url: "https://team.atlassian.net/browse/AB-1",
      description: "",
      details: [],
      branchPrefix: "AB-1",
    },
  ]);
});

test("a key finds that issue, whoever has it", async () => {
  const { calls, tracker } = jira(() => json(ISSUE));
  const issues = await tracker.search(" bwlt-12 ");
  expect(calls).toHaveLength(1);
  expect(calls[0].url.href).toBe(
    "https://team.atlassian.net/rest/api/3/issue/BWLT-12?fields=summary,status,description,issuetype,priority,updated",
  );
  expect(issues.map((issue) => issue.key)).toEqual(["BWLT-12"]);
});

test("a key nobody has is no result; any other refusal is an error", async () => {
  const missing = jira(() => json({ errorMessages: ["Issue does not exist"] }, 404));
  expect(await missing.tracker.search("BWLT-999")).toEqual([]);
  const denied = jira(() => json({}, 401));
  await expect(denied.tracker.search("BWLT-999")).rejects.toThrow(
    "Jira rejected the saved sign-in details.",
  );
});

test("the account is the signed-in user's name", async () => {
  const named = jira(() => json({ displayName: "Rina Putri", emailAddress: "me@team.test" }));
  expect(await named.tracker.account()).toBe("Rina Putri");
  expect(named.calls[0].url.href).toBe("https://team.atlassian.net/rest/api/3/myself");
  const hidden = jira(() => json({}));
  expect(await hidden.tracker.account()).toBe("me@team.test");
});

test("a site that is not https is refused before anything is sent", async () => {
  const { calls, tracker } = jira(() => json({ issues: [] }), "http://team.atlassian.net");
  await expect(tracker.search("")).rejects.toBeInstanceOf(TrackerError);
  await expect(tracker.account()).rejects.toThrow("The Jira address must start with https://.");
  expect(calls).toEqual([]);
});

const text = (value: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: value }] }],
});
const COMMENTS = {
  total: 23,
  // Newest first, as asked.
  comments: [
    {
      id: "902",
      author: { displayName: "Rina Putri" },
      body: text("Done on dev."),
      created: "2026-11-14T03:00:00.000+0000",
    },
    { id: "901", author: null, body: text("Which env?") },
  ],
};
const TRANSITIONS = {
  transitions: [
    { id: "21", name: "Start review", to: { name: "In Review" } },
    { id: "31", name: "Done", to: { name: "Done" } },
  ],
};

function detailAnswers(url: URL): Response {
  if (url.pathname.endsWith("/comment")) return json(COMMENTS);
  if (url.pathname.endsWith("/transitions")) return json(TRANSITIONS);
  return json(ISSUE);
}

test("a task's page reads the issue, its newest comments and where it can move", async () => {
  const { calls, tracker } = jira(detailAnswers);
  const detail = await tracker.detail("bwlt-12");
  expect(calls.map((call) => call.url.pathname + call.url.search)).toEqual([
    "/rest/api/3/issue/BWLT-12?fields=summary,status,description,issuetype,priority,updated",
    "/rest/api/3/issue/BWLT-12/comment?orderBy=-created&maxResults=20",
    "/rest/api/3/issue/BWLT-12/transitions",
  ]);
  expect(detail).toMatchObject({ id: "BWLT-12", status: "In Progress", markdown: false });
  // Oldest first, as a thread reads.
  expect(detail.comments).toEqual([
    { id: "901", author: "Someone", at: "", text: "Which env?" },
    { id: "902", author: "Rina Putri", at: "2026-11-14T03:00:00.000Z", text: "Done on dev." },
  ]);
  expect(detail.earlierComments).toBe(21);
  expect(detail.changes).toEqual([
    { id: "21", label: "In Review" },
    { id: "31", label: "Done" },
  ]);
});

test("a task that is gone, or hidden from the saved account, says so", async () => {
  const { tracker } = jira(() => json({ errorMessages: ["Issue does not exist"] }, 404));
  await expect(tracker.detail("BWLT-999")).rejects.toThrow(
    "Jira has no such issue, or the saved account cannot see it.",
  );
});

test("an id that is no issue key is refused before anything is sent", async () => {
  const { calls, tracker } = jira(detailAnswers);
  for (const id of ["../myself", "BWLT-12/comment", "", "12"]) {
    await expect(tracker.detail(id)).rejects.toThrow("That is no Jira issue key.");
    await expect(tracker.comment(id, "hi")).rejects.toThrow("That is no Jira issue key.");
    await expect(tracker.change(id, "21")).rejects.toThrow("That is no Jira issue key.");
  }
  await expect(tracker.change("BWLT-12", "21/../x")).rejects.toThrow(
    "That is no Jira status change.",
  );
  expect(calls).toEqual([]);
});

test("a comment is posted as a document that holds the text as it was typed", async () => {
  const { calls, tracker } = jira(() => json({ id: "903" }, 201));
  await tracker.comment("BWLT-12", "LGTM *as is*\nsecond line");
  expect(calls).toHaveLength(1);
  expect(calls[0].method).toBe("POST");
  expect(calls[0].url.href).toBe("https://team.atlassian.net/rest/api/3/issue/BWLT-12/comment");
  expect(calls[0].body).toEqual({
    body: {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "LGTM *as is*" },
            { type: "hardBreak" },
            { type: "text", text: "second line" },
          ],
        },
      ],
    },
  });
});

test("a status change sends the transition, and a refusal carries Jira's reason", async () => {
  const moved = jira(() => new Response(null, { status: 204 }));
  await moved.tracker.change("BWLT-12", "21");
  expect(moved.calls[0].method).toBe("POST");
  expect(moved.calls[0].url.href).toBe(
    "https://team.atlassian.net/rest/api/3/issue/BWLT-12/transitions",
  );
  expect(moved.calls[0].body).toEqual({ transition: { id: "21" } });

  const refused = jira(() =>
    json({ errorMessages: ["Transition is not valid."], errors: { resolution: "Pick one." } }, 400),
  );
  await expect(refused.tracker.change("BWLT-12", "31")).rejects.toThrow(
    "Jira refused the change: Transition is not valid. Pick one.",
  );
});

test("a status is named by where it ends; two moves to one status carry their names", () => {
  const to = (name: string) => ({ name });
  expect(
    statusChanges(
      [
        { id: "1", name: "Reject", to: to("To Do") },
        { id: "2", name: "Reopen", to: to("To Do") },
        { id: "3", name: "Done", to: to("Done") },
        // Ends where the issue is, or nowhere: no move.
        { id: "4", name: "Comment", to: to("In Review") },
        { id: "5", name: "Odd", to: null },
      ],
      "In Review",
    ),
  ).toEqual([
    { id: "1", label: "To Do (Reject)" },
    { id: "2", label: "To Do (Reopen)" },
    { id: "3", label: "Done" },
  ]);
});

test("Jira has no merge requests", () => {
  expect(jira(() => json({})).tracker.mergeRequests).toBeUndefined();
});
