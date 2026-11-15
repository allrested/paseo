import { expect, test } from "vitest";
import { TrackerError } from "./issue.js";
import { createJira } from "./jira.js";

interface Call {
  url: URL;
  headers: Record<string, string>;
}

function jira(respond: (url: URL) => Response, site = "https://team.atlassian.net/") {
  const calls: Call[] = [];
  const request: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, headers: init?.headers as Record<string, string> });
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
    fields: "summary,status,description,issuetype,priority",
  });
  expect(calls[0].headers.Authorization).toBe(
    `Basic ${Buffer.from("me@team.test:s3cret").toString("base64")}`,
  );
  expect(issues).toEqual([
    {
      source: "jira",
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
    "https://team.atlassian.net/rest/api/3/issue/BWLT-12?fields=summary,status,description,issuetype,priority",
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
