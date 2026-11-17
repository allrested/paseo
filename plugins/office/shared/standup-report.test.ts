import { expect, test } from "vitest";
import type { OfficeSnapshot } from "./contracts.js";
import { buildOfficeModel } from "./model.js";
import { standupReport } from "./standup-report.js";
import { standupTeams, standupText } from "./standup-text.js";

const NOW = Date.parse("2026-11-16T09:00:00.000Z");

test("the server's report is the card's Copy as text", () => {
  const snapshot: OfficeSnapshot = {
    agents: [
      {
        id: "a1",
        title: "Builder",
        provider: "claude",
        model: null,
        status: "idle",
        workspaceId: "w1",
        parentAgentId: null,
        permissions: [],
        createdAt: "2026-11-16T07:00:00.000Z",
      },
    ],
    workspaces: [
      {
        id: "w1",
        name: "shop-api",
        projectName: "shop",
        branch: "main",
        pullRequest: {
          number: 12,
          url: "https://forge.example/pull/12",
          title: "Fix checkout",
          base: "main",
          state: "open",
          checks: "success",
          runs: [],
          review: null,
          conflicts: false,
        },
      },
    ],
    activity: {},
    boards: {
      w1: [
        {
          id: "p1",
          seq: 1,
          board: "w1",
          kind: "note",
          text: "Checkout is fixed.",
          author: "a1",
          createdAt: "2026-11-16T08:00:00.000Z",
          updatedAt: "2026-11-16T08:00:00.000Z",
        },
      ],
    },
    wake: { paused: false, queued: {} },
  };

  expect(standupReport(snapshot, NOW)).toBe(
    standupText(standupTeams(buildOfficeModel(snapshot), NOW)),
  );
  expect(standupReport(snapshot, NOW)).toContain("shop-api (shop) · main");
  expect(standupReport(snapshot, NOW)).toContain("- Builder: Idle. Said: Checkout is fixed.");
});
