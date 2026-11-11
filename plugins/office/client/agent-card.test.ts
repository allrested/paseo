import { expect, test } from "vitest";
import type { OfficeAgent } from "../shared/contracts.js";
import { stateLabel, textAfterSend } from "./agent-card.js";

function agent(overrides: Partial<OfficeAgent>): OfficeAgent {
  return {
    id: "a1",
    title: "A1",
    provider: "claude",
    model: "opus",
    status: "idle",
    workspaceId: "w1",
    parentAgentId: null,
    permissions: [],
    createdAt: "2026-11-11T08:00:00.000Z",
    ...overrides,
  };
}

test("the sent text is cleared", () => {
  const text: string = textAfterSend("  fix the tests ", "fix the tests");
  expect(text).toEqual("");
});

test("text typed while sending is kept", () => {
  const text: string = textAfterSend("fix the tests and lint", "fix the tests");
  expect(text).toEqual("fix the tests and lint");
});

test("an agent nobody waits on shows its status", () => {
  const labels: string[] = [
    stateLabel(agent({ status: "running" })),
    stateLabel(agent({ status: "idle" })),
    stateLabel(agent({ status: "initializing" })),
  ];
  expect(labels).toEqual(["Running", "Idle", "Starting"]);
});

test("a running agent with a request says it needs permission, as its row does", () => {
  const waiting: OfficeAgent = agent({
    status: "running",
    permissions: [{ id: "p1", kind: "tool", title: "Run npm run build:server" }],
  });
  expect(stateLabel(waiting)).toEqual("Needs permission");
});

test("a failed agent says error", () => {
  expect(stateLabel(agent({ status: "error" }))).toEqual("Error");
});
