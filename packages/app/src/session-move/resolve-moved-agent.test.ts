import { describe, expect, it } from "vitest";
import {
  isSessionAgentArchived,
  resolveMovedAgentId,
  type MovableAgent,
} from "./resolve-moved-agent";

const ARCHIVED_AT = new Date("2026-11-05T00:00:00Z");

describe("resolveMovedAgentId", () => {
  const agents = new Map<string, MovableAgent>([
    ["a", { id: "a", archivedAt: ARCHIVED_AT, labels: { "paseo.moved-to-agent-id": "b" } }],
    [
      "b",
      {
        id: "b",
        archivedAt: new Date("2026-11-05T01:00:00Z"),
        labels: { "paseo.moved-to-agent-id": "c" },
      },
    ],
    ["c", { id: "c", archivedAt: null, labels: { "paseo.moved-from-agent-id": "b" } }],
  ]);
  it("follows a chain of moves to the live agent", () => {
    expect(resolveMovedAgentId("a", (id) => agents.get(id) ?? null)).toBe("c");
  });
  it("returns null for an agent that was not moved", () => {
    expect(resolveMovedAgentId("c", (id) => agents.get(id) ?? null)).toBeNull();
  });
  it("follows a chain that ends at an agent moved back to", () => {
    const movedBack = new Map<string, MovableAgent>([
      ["b", { id: "b", archivedAt: ARCHIVED_AT, labels: { "paseo.moved-to-agent-id": "c" } }],
      ["c", { id: "c", archivedAt: ARCHIVED_AT, labels: { "paseo.moved-to-agent-id": "a" } }],
      ["a", { id: "a", archivedAt: null, labels: { "paseo.moved-from-agent-id": "c" } }],
    ]);
    expect(resolveMovedAgentId("b", (id) => movedBack.get(id) ?? null)).toBe("a");
  });
  it("stops on a cycle", () => {
    const cyclic = new Map<string, MovableAgent>([
      ["x", { id: "x", archivedAt: ARCHIVED_AT, labels: { "paseo.moved-to-agent-id": "y" } }],
      ["y", { id: "y", archivedAt: ARCHIVED_AT, labels: { "paseo.moved-to-agent-id": "x" } }],
    ]);
    expect(resolveMovedAgentId("x", (id) => cyclic.get(id) ?? null)).toBeNull();
  });
});

describe("isSessionAgentArchived", () => {
  const live = { archivedAt: null };
  const archived = { archivedAt: ARCHIVED_AT };
  const session = {
    agents: new Map([["live", live]]),
    agentDetails: new Map([["archived", archived]]),
  };

  it("is true for an archived agent fetched for its tab", () => {
    expect(isSessionAgentArchived(session, "archived")).toBe(true);
  });

  it("is false for a live agent and for one the session does not hold yet", () => {
    expect(isSessionAgentArchived(session, "live")).toBe(false);
    expect(isSessionAgentArchived(session, "unknown")).toBe(false);
    expect(isSessionAgentArchived(undefined, "live")).toBe(false);
  });
});
