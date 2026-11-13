import { describe, expect, test } from "vitest";
import {
  MOVED_FROM_AGENT_ID_LABEL,
  MOVED_TO_AGENT_ID_LABEL,
} from "@getpaseo/protocol/agent-labels";
import { resolveMoveBackChain, resolveMovedAgent } from "./move-agent.js";

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

/** `to: string` is an archived agent that moved there; "live" is not archived; "dead" is archived with no link. */
function moved(agents: Record<string, string>) {
  return async (agentId: string) => {
    const state = agents[agentId];
    if (state === undefined) return null;
    if (state === "live") return { archived: false, labels: {} };
    if (state === "dead") return { archived: true, labels: {} };
    return { archived: true, labels: { [MOVED_TO_AGENT_ID_LABEL]: state } };
  };
}

describe("resolveMovedAgent", () => {
  test("an agent that is not archived is itself", async () => {
    expect(await resolveMovedAgent("a", moved({ a: "live" }))).toBe("a");
  });

  test("follows one move", async () => {
    expect(await resolveMovedAgent("a", moved({ a: "b", b: "live" }))).toBe("b");
  });

  test("follows two moves", async () => {
    expect(await resolveMovedAgent("a", moved({ a: "b", b: "c", c: "live" }))).toBe("c");
  });

  test("is null when the chain ends at an archived agent with no link", async () => {
    expect(await resolveMovedAgent("a", moved({ a: "b", b: "dead" }))).toBeNull();
  });

  test("is null when an agent in the chain has no record", async () => {
    expect(await resolveMovedAgent("a", moved({ a: "gone" }))).toBeNull();
    expect(await resolveMovedAgent("missing", moved({}))).toBeNull();
  });

  test("is null for a loop", async () => {
    expect(await resolveMovedAgent("a", moved({ a: "b", b: "a" }))).toBeNull();
  });

  test("a live agent ends the walk whatever stale label it carries", async () => {
    const stale = async (agentId: string) =>
      agentId === "a"
        ? { archived: false, labels: { [MOVED_TO_AGENT_ID_LABEL]: "b" } }
        : { archived: false, labels: {} };
    expect(await resolveMovedAgent("a", stale)).toBe("a");
  });
});
