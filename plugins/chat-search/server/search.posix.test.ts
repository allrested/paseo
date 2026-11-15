import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentListPage, AgentListRequest, AgentsPort, AgentSummary } from "./agents.js";
import { kiroStore } from "./kiro.js";
import { MAX_CHATS, searchChats } from "./search.js";
import { claudeStore } from "./stores.js";

let root: string;

const line = (value: unknown) => `${JSON.stringify(value)}\n`;
const prompt = (text: string, at = "2026-11-14T08:00:00.000Z") =>
  line({ type: "user", cwd: "/work/shop", timestamp: at, message: { content: text } });
const answer = (text: string, at = "2026-11-14T08:00:05.000Z") =>
  line({
    type: "assistant",
    cwd: "/work/shop",
    timestamp: at,
    message: { content: [{ type: "text", text }] },
  });
const toolOutput = (text: string) =>
  line({ type: "user", message: { content: [{ type: "tool_result", content: text }] } });

function chat(sessionId: string, changed: string, text: string, project = "-work-shop"): void {
  const dir = join(root, project);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${sessionId}.jsonl`);
  writeFileSync(file, text);
  const at = new Date(changed);
  utimesSync(file, at, at);
}

function agentsOf(pages: AgentSummary[][]): AgentsPort & { requests: AgentListRequest[] } {
  const requests: AgentListRequest[] = [];
  return {
    requests,
    list: async (request): Promise<AgentListPage> => {
      requests.push(request);
      const index = request.page.cursor === undefined ? 0 : Number(request.page.cursor);
      const hasMore = index + 1 < pages.length;
      return {
        entries: (pages[index] ?? []).map((agent) => ({ agent })),
        pageInfo: { hasMore, nextCursor: hasMore ? String(index + 1) : null },
      };
    },
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "chat-search-root-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("searchChats", () => {
  it("finds the chats that say the words, here first and the rest apart, newest first", async () => {
    chat("s-old", "2026-11-10T08:00:00Z", prompt("Why is the rounding wrong?"));
    chat(
      "s-new",
      "2026-11-14T08:00:00Z",
      prompt("Fix the checkout total") + answer("The rounding happens before the tax."),
    );
    chat("s-terminal", "2026-11-12T08:00:00Z", prompt("Explain ROUNDING modes"), "-home-me");
    chat("s-other", "2026-11-13T08:00:00Z", prompt("Nothing about it"));
    chat("s-tool", "2026-11-13T09:00:00Z", prompt("Run the tests") + toolOutput("rounding ok"));
    const agents = agentsOf([
      [
        { id: "agent-new", title: "Checkout total", persistence: { sessionId: "s-new" } },
        { id: "agent-old", title: null, persistence: { sessionId: "s-old" } },
        { id: "agent-other", title: "Other", persistence: { sessionId: "s-other" } },
      ],
    ]);

    const result = await searchChats(" Rounding ", { stores: [claudeStore([root])], agents });

    expect(result).toEqual({
      chats: [
        {
          provider: "claude",
          sessionId: "s-new",
          agentId: "agent-new",
          title: "Checkout total",
          folder: "/work/shop",
          changedAt: "2026-11-14T08:00:00.000Z",
          matches: 1,
          snippets: [
            {
              role: "assistant",
              at: "2026-11-14T08:00:05.000Z",
              before: "The ",
              match: "rounding",
              after: " happens before the tax.",
            },
          ],
        },
        {
          provider: "claude",
          sessionId: "s-old",
          agentId: "agent-old",
          // An agent without a title takes the chat's own.
          title: "Why is the rounding wrong?",
          folder: "/work/shop",
          changedAt: "2026-11-10T08:00:00.000Z",
          matches: 1,
          snippets: [
            {
              role: "user",
              at: "2026-11-14T08:00:00.000Z",
              before: "Why is the ",
              match: "rounding",
              after: " wrong?",
            },
          ],
        },
      ],
      others: [
        {
          provider: "claude",
          sessionId: "s-terminal",
          agentId: null,
          title: "Explain ROUNDING modes",
          folder: "/work/shop",
          changedAt: "2026-11-12T08:00:00.000Z",
          matches: 1,
          snippets: [
            {
              role: "user",
              at: "2026-11-14T08:00:00.000Z",
              before: "Explain ",
              match: "ROUNDING",
              after: " modes",
            },
          ],
        },
      ],
      more: false,
    });
  });

  it("searches every store as one list: each hit names its provider, the newest first", async () => {
    const kiro = join(root, "kiro");
    mkdirSync(kiro);
    const kiroChat = (sessionId: string, changed: string, said: string) => {
      const file = join(kiro, `${sessionId}.jsonl`);
      writeFileSync(
        file,
        line({
          version: "v1",
          kind: "Prompt",
          data: { content: [{ kind: "text", data: said }], meta: { timestamp: 1_794_000_000 } },
        }),
      );
      writeFileSync(join(kiro, `${sessionId}.json`), JSON.stringify({ cwd: "/work/api" }));
      utimesSync(file, new Date(changed), new Date(changed));
    };
    // Claude's chats in a folder of their own, so Kiro's folder is not taken for a project.
    const project = "claude/-work-shop";
    chat("c-old", "2026-11-10T08:00:00Z", prompt("the needle, long ago"), project);
    kiroChat("k-mid", "2026-11-12T08:00:00Z", "the needle in Kiro");
    chat("c-new", "2026-11-14T08:00:00Z", prompt("the needle today"), project);
    kiroChat("k-agent", "2026-11-13T08:00:00Z", "a needle for an agent");
    const agents = agentsOf([
      [{ id: "agent-k", title: "Kiro agent", persistence: { sessionId: "k-agent" } }],
    ]);

    const result = await searchChats("needle", {
      stores: [claudeStore([join(root, "claude")]), kiroStore(kiro)],
      agents,
    });

    expect(result.chats.map((hit) => [hit.provider, hit.sessionId, hit.agentId])).toEqual([
      ["kiro", "k-agent", "agent-k"],
    ]);
    expect(result.others.map((hit) => [hit.provider, hit.sessionId, hit.folder])).toEqual([
      ["claude", "c-new", "/work/shop"],
      ["kiro", "k-mid", "/work/api"],
      ["claude", "c-old", "/work/shop"],
    ]);
  });

  it("asks for every agent, archived and background ones too, page after page", async () => {
    chat("s-2", "2026-11-14T08:00:00Z", prompt("needle"));
    const agents = agentsOf([
      [{ id: "a1", title: "One", persistence: { sessionId: "s-1" } }],
      [{ id: "a2", title: "Two", persistence: null, runtimeInfo: { sessionId: "s-2" } }],
    ]);
    const result = await searchChats("needle", { stores: [claudeStore([root])], agents });
    expect(result.chats.map((hit) => hit.agentId)).toEqual(["a2"]);
    expect(agents.requests).toEqual([
      {
        includeBackground: true,
        filter: { includeArchived: true, includeBackground: true },
        page: { limit: 200, cursor: undefined },
      },
      {
        includeBackground: true,
        filter: { includeArchived: true, includeBackground: true },
        page: { limit: 200, cursor: "1" },
      },
    ]);
  });

  it("reads the newest 40 chats that match and says there are more", async () => {
    for (let i = 0; i < MAX_CHATS + 2; i += 1) {
      const minute = String(i + 1).padStart(2, "0");
      chat(`s-${minute}`, `2026-10-01T08:${minute}:00Z`, prompt("needle"));
    }
    const result = await searchChats("needle", {
      stores: [claudeStore([root])],
      agents: agentsOf([[]]),
    });
    expect(result.more).toBe(true);
    expect(result.others).toHaveLength(MAX_CHATS);
    expect(result.others[0]?.sessionId).toBe("s-42");
    expect(result.others.at(-1)?.sessionId).toBe("s-03");
  });

  it("finds words made of punctuation", async () => {
    chat("s-1", "2026-11-14T08:00:00Z", prompt("is a !== b right?"));
    const result = await searchChats("!== ", {
      stores: [claudeStore([root])],
      agents: agentsOf([[]]),
    });
    expect(result.others.map((hit) => hit.snippets[0]?.match)).toEqual(["!=="]);
  });

  it("refuses fewer than three characters before it reads anything", async () => {
    const agents = agentsOf([[]]);
    const list = vi.spyOn(agents, "list");
    await expect(searchChats(" ab ", { stores: [claudeStore([root])], agents })).rejects.toThrow(
      "Type at least 3 characters",
    );
    expect(list).not.toHaveBeenCalled();
  });

  it("is empty on a host with no transcripts, without asking for the agents", async () => {
    const agents = agentsOf([[]]);
    const list = vi.spyOn(agents, "list");
    expect(
      await searchChats("needle", {
        stores: [claudeStore([]), kiroStore(join(root, "no-kiro"))],
        agents,
      }),
    ).toEqual({
      chats: [],
      others: [],
      more: false,
    });
    expect(list).not.toHaveBeenCalled();
  });
});
