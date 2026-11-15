import { expect, test } from "vitest";
import { createGitlab } from "./gitlab.js";

interface Call {
  url: URL;
  headers: Record<string, string>;
}

function gitlab(respond: (url: URL) => Response, url = "https://git.team.test/") {
  const calls: Call[] = [];
  const request: typeof fetch = async (input, init) => {
    const target = new URL(String(input));
    calls.push({ url: target, headers: init?.headers as Record<string, string> });
    return respond(target);
  };
  return { calls, tracker: createGitlab({ url, token: "glpat-s3cret", request }) };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const ISSUE = {
  iid: 7,
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
      key: "shop/web#7",
      title: "Rate limit the login form",
      status: "Open",
      url: "https://git.team.test/shop/web/-/issues/7",
      description: "Five tries a minute.",
      details: [["Labels", "security, backend"]],
      branchPrefix: "7",
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
  const bare = { iid: 3, title: "Typo", web_url: "https://git.team.test/a/b/-/issues/3" };
  const { tracker } = gitlab(() => json([bare]));
  expect(await tracker.search("")).toEqual([
    {
      source: "gitlab",
      key: "#3",
      title: "Typo",
      status: "Open",
      url: "https://git.team.test/a/b/-/issues/3",
      description: "",
      details: [],
      branchPrefix: "3",
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
