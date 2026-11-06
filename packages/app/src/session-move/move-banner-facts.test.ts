import { describe, expect, it } from "vitest";
import type { Agent } from "@/stores/session-store";
import { selectMoveBannerFacts, selectMovedFromAgentToFetch } from "./move-banner-facts";

type FixtureAgent = Pick<Agent, "provider" | "archivedAt" | "labels" | "limitReached">;

const moved: FixtureAgent = {
  provider: "codex",
  archivedAt: null,
  labels: { "paseo.moved-from-agent-id": "original" },
};
const original: FixtureAgent = {
  provider: "claude-work",
  archivedAt: new Date("2026-11-05T00:00:00Z"),
  labels: { "paseo.moved-to-agent-id": "moved" },
};

function session(input: { agents?: [string, FixtureAgent][]; details?: [string, FixtureAgent][] }) {
  return { agents: new Map(input.agents ?? []), agentDetails: new Map(input.details ?? []) };
}

describe("selectMoveBannerFacts", () => {
  it("reads the original's provider from the details map", () => {
    const facts = selectMoveBannerFacts(
      session({ agents: [["moved", moved]], details: [["original", original]] }),
      "moved",
    );
    expect(facts).toEqual({
      kind: "live",
      provider: "codex",
      hasReachedLimit: false,
      movedFromAgentId: "original",
      movedFromProvider: "claude-work",
    });
    expect(selectMovedFromAgentToFetch(facts)).toBeNull();
  });

  it("asks for the original when the session does not hold it", () => {
    const facts = selectMoveBannerFacts(session({ agents: [["moved", moved]] }), "moved");
    expect(facts).toMatchObject({ kind: "live", movedFromProvider: null });
    expect(selectMovedFromAgentToFetch(facts)).toBe("original");
  });

  it("knows the agent hit its limit when the host says so", () => {
    const limited: FixtureAgent = {
      ...moved,
      limitReached: { at: "2026-11-06T10:00:00Z", message: "usage limit reached" },
    };
    expect(selectMoveBannerFacts(session({ agents: [["moved", limited]] }), "moved")).toMatchObject(
      { kind: "live", hasReachedLimit: true },
    );
  });

  it("fetches nothing for an agent that was not moved", () => {
    const facts = selectMoveBannerFacts(
      session({ agents: [["plain", { ...moved, labels: {} }]] }),
      "plain",
    );
    expect(selectMovedFromAgentToFetch(facts)).toBeNull();
  });

  it("treats an archived agent and a missing one alike", () => {
    const archived = selectMoveBannerFacts(
      session({
        details: [["moved", { ...moved, archivedAt: new Date("2026-11-05T01:00:00Z") }]],
      }),
      "moved",
    );
    const missing = selectMoveBannerFacts(undefined, "moved");
    expect(archived).toEqual({ kind: "inactive" });
    expect(missing).toEqual({ kind: "inactive" });
    expect(selectMovedFromAgentToFetch(archived)).toBeNull();
    expect(selectMovedFromAgentToFetch(missing)).toBeNull();
  });
});
