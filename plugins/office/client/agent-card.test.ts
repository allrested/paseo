import { expect, test } from "vitest";
import type { OfficeAgent } from "../shared/contracts.js";
import {
  countTurns,
  shownStopError,
  stateLabel,
  textAfterSend,
  type StopFailure,
  type TurnCount,
} from "./agent-card.js";

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

function turnsAfter(...running: boolean[]): TurnCount {
  return running.reduce((count, now) => countTurns(count, now), countTurns(null, false));
}

function failure(turn: number): StopFailure {
  return { turn, text: "Unable to stop: Paseo API is disposed" };
}

test("each run of the agent is a new turn", () => {
  const counts = [turnsAfter(true), turnsAfter(true, false), turnsAfter(true, false, true)];
  expect(counts).toEqual([
    { turns: 1, running: true },
    { turns: 1, running: false },
    { turns: 2, running: true },
  ]);
});

test("an agent seen running first is in its first turn", () => {
  expect(countTurns(null, true)).toEqual({ turns: 1, running: true });
});

test("a render that does not change the run keeps the count as it is", () => {
  const count = turnsAfter(true);
  const same: boolean = countTurns(count, true) === count;
  expect(same).toEqual(true);
});

test("a Stop failure shows under the turn it was for", () => {
  expect(shownStopError(failure(1), turnsAfter(true))).toEqual(
    "Unable to stop: Paseo API is disposed",
  );
});

test("a Stop failure that came back after its turn ended does not show under the next turn", () => {
  const texts = [
    shownStopError(failure(1), turnsAfter(true, false)),
    shownStopError(failure(1), turnsAfter(true, false, true)),
  ];
  expect(texts).toEqual([null, null]);
});

test("no Stop failure shows nothing", () => {
  expect(shownStopError(null, turnsAfter(true))).toEqual(null);
});
