import { describe, expect, it } from "vitest";
import type { Account, MoveJob } from "../shared/rpc.js";
import {
  defaultAccountOptions,
  describeAccount,
  describeAgents,
  describeMoveJob,
  moveActionLabel,
  moveHint,
  moveTargetOptions,
  nameError,
  needsSignIn,
  type MoveHintInput,
  type SelectOption,
} from "./view-model.js";

const MAIN: Account = {
  provider: "claude",
  directory: "/home/u/.claude",
  label: "Main account",
  main: true,
  signedIn: true,
  loginExpired: false,
  providerReady: true,
  usage: { usedPct: 62.4, windowLabel: "Session", planLabel: "Max" },
  agents: { total: 3, busy: 1 },
  problems: [],
};
const WORK: Account = {
  ...MAIN,
  provider: "claude-work",
  directory: "/home/u/.claude-work",
  label: "work",
  main: false,
  usage: { usedPct: 20, windowLabel: "Weekly", planLabel: null },
  agents: { total: 1, busy: 0 },
};
const SIGNED_OUT: Account = {
  ...WORK,
  provider: "claude-new",
  directory: "/home/u/.claude-new",
  label: "new",
  signedIn: false,
  usage: null,
  agents: { total: 0, busy: 0 },
};
const EXPIRED: Account = {
  ...WORK,
  provider: "claude-old",
  directory: "/home/u/.claude-old",
  label: "old",
  loginExpired: true,
  usage: null,
  agents: { total: 1, busy: 1 },
};
const TURNED_OFF: Account = {
  ...WORK,
  provider: "claude-team",
  directory: "/home/u/.claude-team",
  label: "team",
  providerReady: false,
  usage: null,
  agents: { total: 0, busy: 0 },
  problems: ["claude-team is turned off in the host config"],
};
const ACCOUNTS: Account[] = [MAIN, WORK, SIGNED_OUT, EXPIRED, TURNED_OFF];

function job(overrides: Partial<MoveJob>): MoveJob {
  return {
    from: "claude",
    to: "claude-work",
    total: 3,
    busy: 0,
    moved: 0,
    handedOff: 0,
    skipped: 0,
    failed: [],
    done: false,
    ...overrides,
  };
}

describe("describeAccount", () => {
  it("shows the plan, the tightest window, the agents and the directory", () => {
    expect(describeAccount(MAIN)).toBe(
      "Max · Session 62% used · 3 agents, 1 in a turn · /home/u/.claude",
    );
    expect(describeAccount(WORK)).toBe("Weekly 20% used · 1 agent · /home/u/.claude-work");
  });

  it("shows the login state when there is no usage to show", () => {
    expect(describeAccount(SIGNED_OUT)).toBe("Not signed in · No agents · /home/u/.claude-new");
    expect(describeAccount(EXPIRED)).toBe(
      "Login expired · 1 agent, in a turn · /home/u/.claude-old",
    );
    expect(describeAccount(TURNED_OFF)).toBe("Usage unknown · No agents · /home/u/.claude-team");
  });
});

describe("describeAgents", () => {
  it("counts the agents and the ones in a turn", () => {
    expect(describeAgents({ total: 0, busy: 0 })).toBe("No agents");
    expect(describeAgents({ total: 2, busy: 0 })).toBe("2 agents");
    expect(describeAgents({ total: 3, busy: 2 })).toBe("3 agents, 2 in a turn");
  });
});

describe("needsSignIn", () => {
  it("asks for a sign-in without a login or with an expired one", () => {
    expect(needsSignIn(SIGNED_OUT)).toBe(true);
    expect(needsSignIn(EXPIRED)).toBe(true);
    expect(needsSignIn(WORK)).toBe(false);
  });
});

describe("picker options", () => {
  it("lists Auto first, then every account", () => {
    const expected: SelectOption[] = [
      { label: "Auto", value: "auto" },
      { label: "Main account", value: "claude" },
      { label: "work", value: "claude-work" },
      { label: "new", value: "claude-new" },
      { label: "old", value: "claude-old" },
      { label: "team", value: "claude-team" },
    ];
    expect(defaultAccountOptions(ACCOUNTS, "claude")).toEqual(expected);
  });

  it("keeps a saved account that is gone, so the picker can show it", () => {
    const expected: SelectOption[] = [
      { label: "Auto", value: "auto" },
      { label: "Main account", value: "claude" },
      { label: "claude-gone (unavailable)", value: "claude-gone" },
    ];
    expect(defaultAccountOptions([MAIN], "claude-gone")).toEqual(expected);
    expect(defaultAccountOptions([MAIN], null)).toHaveLength(2);
  });

  it("offers only other accounts that can take agents as move targets", () => {
    const fromMain: SelectOption[] = [{ label: "work", value: "claude-work" }];
    const fromWork: SelectOption[] = [{ label: "Main account", value: "claude" }];
    expect(moveTargetOptions(ACCOUNTS, "claude")).toEqual(fromMain);
    expect(moveTargetOptions(ACCOUNTS, "claude-work")).toEqual(fromWork);
  });
});

describe("describeMoveJob", () => {
  it("counts the move in flight", () => {
    expect(describeMoveJob(job({ moved: 1 }), ACCOUNTS)).toBe(
      "Moving 2 of 3 idle agents from Main account to work...",
    );
  });

  it("reads a single clause without a period", () => {
    expect(describeMoveJob(job({ moved: 3, done: true }), ACCOUNTS)).toBe(
      "Moved 3 of 3 idle agents from Main account to work",
    );
    expect(describeMoveJob(job({ total: 0, done: true }), ACCOUNTS)).toBe(
      "No idle agents to move from Main account",
    );
  });

  it("adds handoffs, agents in a turn, skips and failures as sentences", () => {
    const finished = job({
      total: 4,
      busy: 2,
      moved: 2,
      handedOff: 1,
      skipped: 1,
      failed: [{ agentId: "d", error: "Update the host to move agents." }],
      done: true,
    });
    expect(describeMoveJob(finished, ACCOUNTS)).toBe(
      "Moved 2 of 4 idle agents from Main account to work. 1 move continued through a history handoff. Skipped 2 agents in a turn. Skipped 1 agent that started a turn or went away. 1 move failed: Update the host to move agents.",
    );
    expect(describeMoveJob(job({ total: 0, busy: 2, done: true }), ACCOUNTS)).toBe(
      "No idle agents to move from Main account. Skipped 2 agents in a turn.",
    );
  });

  it("names an account that is gone by its provider", () => {
    expect(
      describeMoveJob(job({ to: "claude-gone", total: 1, moved: 1, done: true }), ACCOUNTS),
    ).toBe("Moved 1 of 1 idle agent from Main account to claude-gone");
  });
});

describe("nameError", () => {
  it("accepts lowercase names and an empty field", () => {
    expect(nameError("")).toBeNull();
    expect(nameError("work-2")).toBeNull();
  });

  it("explains a name that cannot become a provider id", () => {
    expect(nameError("Work")).toBe(
      "Use lowercase letters and digits, with single dashes between them",
    );
    expect(nameError("a".repeat(33))).toBe("Use at most 32 characters");
  });
});

describe("move action", () => {
  it("arms, confirms and shows the move in flight", () => {
    expect(moveActionLabel(false, false)).toBe("Move");
    expect(moveActionLabel(false, true)).toBe("Confirm move");
    expect(moveActionLabel(true, true)).toBe("Moving...");
  });

  it("explains the move before and after the first press", () => {
    const ready: MoveHintInput = {
      idle: 2,
      jobRunning: false,
      armed: false,
      from: "Main account",
      to: "work",
    };
    expect(moveHint(ready)).toBe("Agents in a turn stay where they are");
    expect(moveHint({ ...ready, armed: true })).toBe(
      "Press again within 5 s to move 2 idle agents from Main account to work. Their background shells and watches stop.",
    );
    expect(moveHint({ ...ready, idle: 0 })).toBe("No idle agents on this account");
    expect(moveHint({ ...ready, jobRunning: true })).toBe(
      "Agents are still moving. Wait for that move to finish.",
    );
  });
});
