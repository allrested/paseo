import { describe, expect, test } from "vitest";
import { PARENT_AGENT_ID_LABEL, PARENT_SERVER_ID_LABEL } from "@getpaseo/protocol/agent-labels";
import { registerWatcherNotice, type WatcherNoticeDeps } from "./watcher-notice.js";

interface Registered {
  childAgentId: string;
  callerAgentId: string;
  requireParentOwnership?: boolean;
  pending: boolean;
  state: "held" | "accepted" | "rejected";
}

function subscriptions(told: string[], options: { failOn?: string } = {}) {
  const registered: Registered[] = [];
  const asked: string[] = [];
  const deps: WatcherNoticeDeps = {
    serverId: "here",
    subscriptions: {
      watchersOf: (childAgentId) => {
        asked.push(childAgentId);
        return told;
      },
      register: async (input, pendingDispatch) => {
        if (input.callerAgentId === options.failOn) throw new Error("store unavailable");
        const entry: Registered = { ...input, pending: pendingDispatch === true, state: "held" };
        registered.push(entry);
        return {
          accept: () => {
            entry.state = "accepted";
          },
          reject: async () => {
            entry.state = "rejected";
          },
        };
      },
    },
  };
  return { deps, registered, asked };
}

const MOVE = { agentId: "successor", fromAgentId: "left", labels: {} };

describe("registerWatcherNotice", () => {
  test("holds a notification for the parent and for everyone told about the agent being left", async () => {
    const { deps, registered, asked } = subscriptions(["watcher", "parent"]);
    const notice = await registerWatcherNotice(deps, {
      ...MOVE,
      labels: { [PARENT_AGENT_ID_LABEL]: "parent" },
    });

    expect(asked).toEqual(["left"]);
    expect(registered).toEqual([
      {
        childAgentId: "successor",
        callerAgentId: "parent",
        requireParentOwnership: true,
        pending: true,
        state: "held",
      },
      {
        childAgentId: "successor",
        callerAgentId: "watcher",
        requireParentOwnership: false,
        pending: true,
        state: "held",
      },
    ]);
    notice?.accept();
    expect(registered.map((entry) => entry.state)).toEqual(["accepted", "accepted"]);
  });

  test("withdraws every notification on reject", async () => {
    const { deps, registered } = subscriptions(["watcher", "other"]);

    const notice = await registerWatcherNotice(deps, MOVE);
    await notice?.reject();

    expect(registered.map((entry) => entry.state)).toEqual(["rejected", "rejected"]);
  });

  test("is undefined when nobody waited", async () => {
    const { deps, registered } = subscriptions([]);

    expect(await registerWatcherNotice(deps, MOVE)).toBeUndefined();
    expect(registered).toEqual([]);
  });

  test("leaves out the two agents of the move themselves, and a parent on another host", async () => {
    const { deps, registered } = subscriptions(["successor", "left"]);

    const notice = await registerWatcherNotice(deps, {
      ...MOVE,
      labels: { [PARENT_AGENT_ID_LABEL]: "far-parent", [PARENT_SERVER_ID_LABEL]: "elsewhere" },
    });

    expect(notice).toBeUndefined();
    expect(registered).toEqual([]);
  });

  test("withdraws what it registered when a later registration fails", async () => {
    const { deps, registered } = subscriptions(["first", "second"], { failOn: "second" });

    await expect(registerWatcherNotice(deps, MOVE)).rejects.toThrow("store unavailable");

    expect(registered.map((entry) => [entry.callerAgentId, entry.state])).toEqual([
      ["first", "rejected"],
    ]);
  });
});
