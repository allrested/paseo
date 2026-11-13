import { describe, expect, it } from "vitest";
import { createCommentRouter, type CommentPorts } from "./comments.js";

function ports(over: Partial<CommentPorts> = {}) {
  const sent: { agentId: string; text: string }[] = [];
  let threads = [{ id: "c1" }];
  let idle = true;
  const p: CommentPorts = {
    openThreads: async () => threads,
    prompt: async (_f, ids) => `Fix ${ids.join(",")}`,
    agentOf: async () => "a1",
    agentIdle: async () => idle,
    send: async (agentId, text) => {
      sent.push({ agentId, text });
    },
    log: () => {},
    ...over,
  };
  return {
    p,
    sent,
    setThreads: (t: { id: string }[]) => (threads = t),
    setIdle: (v: boolean) => (idle = v),
  };
}

describe("comment router", () => {
  it("sends new open threads to the idle agent as one prompt", async () => {
    const { p, sent, setThreads } = ports();
    setThreads([{ id: "c1" }, { id: "c2" }]);
    const router = createCommentRouter(p);
    await router.poll("f1");
    expect(sent).toEqual([{ agentId: "a1", text: "Fix c1,c2" }]);
  });
  it("sends a thread only once", async () => {
    const { p, sent } = ports();
    const router = createCommentRouter(p);
    await router.poll("f1");
    await router.turnEnded("a1");
    await router.poll("f1");
    expect(sent).toHaveLength(1);
  });
  it("waits while the agent works and sends when its turn ends, one prompt per turn", async () => {
    const { p, sent, setThreads, setIdle } = ports();
    setIdle(false);
    const router = createCommentRouter(p);
    await router.poll("f1");
    expect(sent).toHaveLength(0);
    setThreads([{ id: "c1" }, { id: "c2" }]);
    await router.poll("f1");
    await router.turnEnded("a1");
    expect(sent).toEqual([{ agentId: "a1", text: "Fix c1,c2" }]);
    setThreads([{ id: "c1" }, { id: "c2" }, { id: "c3" }]);
    setIdle(true);
    await router.poll("f1");
    expect(sent).toHaveLength(1);
    await router.turnEnded("a1");
    expect(sent[1]).toEqual({ agentId: "a1", text: "Fix c3" });
  });
  it("keeps threads waiting while the file has no agent", async () => {
    let agent: string | null = null;
    const { p, sent } = ports({ agentOf: async () => agent });
    const router = createCommentRouter(p);
    await router.poll("f1");
    expect(sent).toHaveLength(0);
    agent = "a2";
    await router.poll("f1");
    expect(sent).toEqual([{ agentId: "a2", text: "Fix c1" }]);
  });
  it("logs a failed send and tries again at the next poll", async () => {
    let fail = true;
    const lines: string[] = [];
    const { p, sent } = ports({
      send: async (agentId, text) => {
        if (fail) throw new Error("agent gone");
        sent.push({ agentId, text });
      },
      log: (line) => lines.push(line),
    });
    const router = createCommentRouter(p);
    await router.poll("f1");
    expect(lines[0]).toContain("agent gone");
    fail = false;
    await router.poll("f1");
    expect(sent).toHaveLength(1);
  });
  it("drops a waiting thread that was resolved before it went out", async () => {
    const { p, sent, setThreads, setIdle } = ports();
    setIdle(false);
    setThreads([{ id: "c1" }, { id: "c2" }]);
    const router = createCommentRouter(p);
    await router.poll("f1");
    setThreads([{ id: "c2" }]);
    await router.poll("f1");
    await router.turnEnded("a1");
    expect(sent).toEqual([{ agentId: "a1", text: "Fix c2" }]);
  });
});
