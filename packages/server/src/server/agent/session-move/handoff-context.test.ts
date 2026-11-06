import { describe, expect, it } from "vitest";
import type { AgentTimelineRow } from "../agent-timeline-store-types.js";
import {
  MOVE_CONTINUE_PROMPT,
  MOVE_HISTORY_MAX_CHARS,
  extendMoveHistory,
  renderMoveHistory,
} from "./handoff-context.js";
import type { MoveChain, MoveHistorySegment } from "./pending-context.js";

function row(seq: number, item: AgentTimelineRow["item"]): AgentTimelineRow {
  return { seq, timestamp: new Date(1_000 * seq).toISOString(), item };
}

function edit(seq: number, filePath: string): AgentTimelineRow {
  return row(seq, {
    type: "tool_call",
    callId: `c${seq}`,
    name: "Edit",
    status: "completed",
    error: null,
    detail: { type: "edit", filePath },
  });
}

function segment(overrides: Partial<MoveHistorySegment> & { agentId: string }): MoveHistorySegment {
  return {
    label: "Claude",
    entries: [],
    files: [],
    openTodos: null,
    lastError: null,
    ...overrides,
  };
}

const rows: AgentTimelineRow[] = [
  row(1, { type: "user_message", text: "Fix the login redirect bug" }),
  row(2, { type: "assistant_message", text: "Looking at auth.ts" }),
  edit(3, "src/auth.ts"),
  row(4, {
    type: "tool_call",
    callId: "c4",
    name: "Write",
    status: "completed",
    error: null,
    detail: { type: "write", filePath: "src/auth.test.ts" },
  }),
  row(5, {
    type: "todo",
    items: [
      { text: "Reproduce", completed: true },
      { text: "Add regression test", completed: false },
    ],
  }),
  row(6, { type: "error", message: "Claude AI usage limit reached" }),
];

describe("extendMoveHistory", () => {
  it("starts a chain at the root with the first task and one segment of its own work", () => {
    const chain = extendMoveHistory({ history: null, agentId: "a", label: "Claude", rows });

    expect(chain.originalTask).toBe("Fix the login redirect bug");
    expect(chain.segments).toHaveLength(1);
    expect(chain.segments[0]).toMatchObject({
      agentId: "a",
      label: "Claude",
      files: ["src/auth.ts", "src/auth.test.ts"],
      openTodos: ["Add regression test"],
      lastError: "Claude AI usage limit reached",
    });
    expect(chain.segments[0]!.entries).toContain("[User] Fix the login redirect bug");
    expect(chain.segments[0]!.entries).toContain("[Assistant] Looking at auth.ts");
  });

  it("takes only the rows after sinceSeq into the new segment and keeps earlier segments", () => {
    const earlier = segment({ agentId: "a", entries: ["[Assistant] A"], files: ["a.ts"] });
    const chain = extendMoveHistory({
      history: { originalTask: "Fix it", sinceSeq: 4, segments: [earlier] },
      agentId: "b",
      label: "Codex",
      rows: [
        row(1, { type: "assistant_message", text: "OLD" }),
        edit(2, "c.ts"),
        row(3, { type: "todo", items: [{ text: "old todo", completed: false }] }),
        row(4, { type: "error", message: "old error" }),
        edit(5, "b.ts"),
        row(6, { type: "assistant_message", text: "NEW" }),
      ],
    });

    expect(chain.segments[0]).toEqual(earlier);
    const own = chain.segments[1]!;
    expect(own).toMatchObject({
      agentId: "b",
      label: "Codex",
      files: ["b.ts"],
      openTodos: null,
      lastError: null,
    });
    expect(own.entries).toContain("[Assistant] NEW");
    expect(own.entries.join("\n")).not.toContain("OLD");
  });

  it("keeps an inherited original task and skips the continue prompt at the root", () => {
    const inherited = extendMoveHistory({
      history: { originalTask: "First task", sinceSeq: 0, segments: [] },
      agentId: "b",
      label: "Codex",
      rows: [row(1, { type: "user_message", text: "Second task" })],
    });
    expect(inherited.originalTask).toBe("First task");

    const root = extendMoveHistory({
      history: { originalTask: null, sinceSeq: 0, segments: [] },
      agentId: "b",
      label: "Codex",
      rows: [
        row(1, { type: "user_message", text: MOVE_CONTINUE_PROMPT }),
        row(2, { type: "user_message", text: "Real task" }),
      ],
    });
    expect(root.originalTask).toBe("Real task");
  });

  it("strips move and chat histories from user messages", () => {
    const chain = extendMoveHistory({
      history: null,
      agentId: "a",
      label: "Claude",
      rows: [
        row(1, { type: "user_message", text: "<paseo-move-history>\nA\n</paseo-move-history>" }),
        row(2, {
          type: "user_message",
          text: "<paseo-move-history>\nB\n</paseo-move-history>\n\nhi",
        }),
        row(3, {
          type: "user_message",
          text: "<chat-history-summary>\nC\n</chat-history-summary>\n\nthere",
        }),
        row(4, { type: "user_message", text: "<paseo-move-history>\nunclosed D" }),
      ],
    });

    expect(chain.segments[0]!.entries).toEqual(["[User] hi", "[User] there"]);
    expect(chain.originalTask).toBe("hi");
  });

  it("keeps an empty tenure as a segment with no entries", () => {
    const chain = extendMoveHistory({
      history: { originalTask: "Fix it", sinceSeq: 0, segments: [segment({ agentId: "a" })] },
      agentId: "b",
      label: "Codex",
      rows: [],
    });

    expect(chain.segments).toEqual([
      segment({ agentId: "a" }),
      segment({ agentId: "b", label: "Codex" }),
    ]);
  });

  it("drops the oldest segment's entries first over the cap and keeps every segment", () => {
    const oldest = segment({
      agentId: "a",
      entries: ["A1 " + "x".repeat(60_000), "A2 " + "x".repeat(30_000)],
      files: ["a.ts"],
      lastError: "err",
    });
    const chain = extendMoveHistory({
      history: { originalTask: "Fix it", sinceSeq: 0, segments: [oldest] },
      agentId: "b",
      label: "Codex",
      rows: [row(1, { type: "assistant_message", text: "B " + "y".repeat(30_000) })],
    });

    const total = chain.segments
      .flatMap((entry) => entry.entries)
      .reduce((sum, text) => sum + text.length + 1, 0);
    expect(total).toBeLessThanOrEqual(MOVE_HISTORY_MAX_CHARS);
    expect(chain.segments.map((entry) => entry.agentId)).toEqual(["a", "b"]);
    expect(chain.segments[0]).toMatchObject({ label: "Claude", files: ["a.ts"], lastError: "err" });
    expect(chain.segments[0]!.entries).toEqual([oldest.entries[1]]);
    expect(chain.segments[1]!.entries).toHaveLength(1);
  });
});

describe("renderMoveHistory", () => {
  const chain: MoveChain = {
    originalTask: "Fix the login redirect bug",
    segments: [
      segment({
        agentId: "a",
        label: "Claude (personal)",
        entries: ["[Assistant] A done"],
        files: ["a.ts"],
        openTodos: ["todo A"],
        lastError: "error A",
      }),
      segment({ agentId: "b", label: "Codex" }),
      segment({
        agentId: "c",
        label: "Claude (work)",
        entries: ["[Assistant] C done"],
        files: ["c.ts"],
        lastError: "error C",
      }),
    ],
  };

  it("renders every segment, oldest first, under a header of the chain's facts", () => {
    const history = renderMoveHistory({
      chain,
      fromLabel: "Claude (work)",
      agentTitle: "Login fix",
      cwd: "/workspace/app",
    });

    expect(history.title).toBe("Chat history");
    expect(history.text.startsWith("<paseo-move-history>\n")).toBe(true);
    expect(history.text.endsWith("\n</paseo-move-history>")).toBe(true);
    const header = history.text.slice(0, history.text.indexOf("<chat-history-summary>"));
    expect(header).toContain("Moved from Claude (work). You are continuing");
    expect(header).toContain("Original task: Fix the login redirect bug");
    expect(header).toContain("- a.ts\n- c.ts");
    expect(header).toContain("- [ ] todo A");
    expect(header).toContain("Last error: error C");
    expect(header).not.toContain("error A");
    expect(history.text).toContain(
      "[Agent] Claude (personal)\n[Assistant] A done\n[Agent] Claude (work)\n[Assistant] C done",
    );
    expect(history.text).not.toContain("[Agent] Codex");
  });

  it("renders only the segments after an agent the session returns to", () => {
    const history = renderMoveHistory({
      chain,
      fromLabel: "Claude (work)",
      agentTitle: null,
      cwd: "/workspace/app",
      afterAgentId: "a",
    });

    const header = history.text.slice(0, history.text.indexOf("<chat-history-summary>"));
    expect(header).toContain("Original task: Fix the login redirect bug");
    expect(header).toContain("- c.ts");
    expect(header).not.toContain("a.ts");
    expect(header).not.toContain("todo A");
    expect(history.text).toContain("[Assistant] C done");
    expect(history.text).not.toContain("A done");

    const unknown = renderMoveHistory({
      chain,
      fromLabel: "Claude (work)",
      agentTitle: null,
      cwd: "/workspace/app",
      afterAgentId: "nobody",
    });
    expect(unknown.text).toContain("[Assistant] A done");
    expect(unknown.text).toContain("[Assistant] C done");
  });

  it("keeps a chain at the cap whole, each kept segment under its label", () => {
    const capped = extendMoveHistory({
      history: {
        originalTask: "Fix it",
        sinceSeq: 0,
        segments: [
          segment({
            agentId: "a",
            label: "Claude (personal)",
            entries: [
              "[Assistant] A1 " + "x".repeat(40_000),
              "[Assistant] A2 " + "x".repeat(40_000),
            ],
          }),
        ],
      },
      agentId: "b",
      label: "Codex",
      rows: [row(1, { type: "assistant_message", text: "B " + "y".repeat(19_900) })],
    });

    const history = renderMoveHistory({
      chain: capped,
      fromLabel: "Codex",
      agentTitle: "t".repeat(2_000),
      cwd: "/".repeat(2_000),
    });

    expect(history.text.includes("[Earlier chat history omitted]")).toBe(false);
    for (const kept of capped.segments.filter((entry) => entry.entries.length > 0)) {
      expect(history.text.includes(`[Agent] ${kept.label}\n${kept.entries[0]}`)).toBe(true);
    }
  });
});
