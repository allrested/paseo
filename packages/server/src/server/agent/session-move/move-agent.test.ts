import { describe, expect, test } from "vitest";
import { MOVED_FROM_AGENT_ID_LABEL } from "@getpaseo/protocol/agent-labels";
import { resolveMoveBackChain } from "./move-agent.js";

function lookup(movedFrom: Record<string, string | null>) {
  return async (agentId: string): Promise<Record<string, string> | null> => {
    if (!(agentId in movedFrom)) return null;
    const from = movedFrom[agentId];
    return from ? { [MOVED_FROM_AGENT_ID_LABEL]: from } : {};
  };
}

describe("resolveMoveBackChain", () => {
  test("lists the direct moved-from agent", async () => {
    expect(await resolveMoveBackChain("b", lookup({ b: "a", a: null }))).toEqual(["a"]);
  });

  test("follows a two-hop chain nearest first", async () => {
    expect(await resolveMoveBackChain("c", lookup({ c: "b", b: "a", a: null }))).toEqual([
      "b",
      "a",
    ]);
  });

  test("stops at an agent with no record", async () => {
    expect(await resolveMoveBackChain("c", lookup({ c: "b", b: "gone" }))).toEqual(["b"]);
  });

  test("stops at a cycle", async () => {
    expect(await resolveMoveBackChain("c", lookup({ c: "b", b: "a", a: "c" }))).toEqual(["b", "a"]);
  });

  test("is empty for an agent that was not moved", async () => {
    expect(await resolveMoveBackChain("a", lookup({ a: null }))).toEqual([]);
  });
});
