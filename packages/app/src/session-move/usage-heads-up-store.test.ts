import { afterEach, describe, expect, it } from "vitest";
import type { UsageHeadsUpDismissal } from "./usage-heads-up";
import {
  dismissUsageHeadsUp,
  selectUsageHeadsUpDismissal,
  useUsageHeadsUpStore,
} from "./usage-heads-up-store";

const AT_WARNING: UsageHeadsUpDismissal = { level: 1, resetsAt: "2026-11-06T09:00:00.000Z" };
const AT_DANGER: UsageHeadsUpDismissal = { level: 2, resetsAt: "2026-11-06T09:00:00.000Z" };
const WEEKLY = "claude-work\nWeekly";

function dismissalFor(serverId: string, windowKey: string | null) {
  return selectUsageHeadsUpDismissal(useUsageHeadsUpStore.getState(), { serverId, windowKey });
}

describe("usage heads-up store", () => {
  afterEach(() => {
    useUsageHeadsUpStore.setState({ dismissals: {} });
  });

  it("keeps a dismissal per host and account window", () => {
    dismissUsageHeadsUp({ serverId: "host-a", windowKey: WEEKLY, dismissal: AT_WARNING });

    expect(dismissalFor("host-a", WEEKLY)).toEqual(AT_WARNING);
    expect(dismissalFor("host-b", WEEKLY)).toBeNull();
    expect(dismissalFor("host-a", "claude-work\nSession")).toBeNull();
    expect(dismissalFor("host-a", null)).toBeNull();
  });

  it("replaces an earlier dismissal of the same window", () => {
    dismissUsageHeadsUp({ serverId: "host-a", windowKey: WEEKLY, dismissal: AT_WARNING });
    dismissUsageHeadsUp({ serverId: "host-a", windowKey: WEEKLY, dismissal: AT_DANGER });

    expect(dismissalFor("host-a", WEEKLY)).toEqual(AT_DANGER);
  });
});
