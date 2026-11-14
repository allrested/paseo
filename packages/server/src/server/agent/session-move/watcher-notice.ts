import { getParentAddressFromLabels } from "@getpaseo/protocol/agent-labels";
import type { FinishRegistration, FinishSubscriptions } from "../finish-subscriptions/index.js";

/** The agent a move hands to, and the agent it leaves. */
export interface WatcherNoticeInput {
  agentId: string;
  fromAgentId: string;
  /** The labels of the agent handed to, which name its parent. */
  labels: Record<string, string>;
}

export interface WatcherNoticeDeps {
  serverId: string;
  subscriptions: Pick<FinishSubscriptions, "register" | "watchersOf">;
}

/**
 * Registers a finish notification from the agent a move hands to, for everyone who waited on
 * the agent it leaves: the parent, and any other agent on this host that still waits on it or
 * was told its turn failed or was cancelled. Their own notifications are spent while the work is
 * not done. Held until `accept()`; undefined when there is nobody to tell.
 */
export async function registerWatcherNotice(
  deps: WatcherNoticeDeps,
  input: WatcherNoticeInput,
): Promise<FinishRegistration | undefined> {
  // The value is whether the notification ends when the agent leaves that caller, as a
  // sub-agent's does for its parent.
  const callers = new Map<string, boolean>();
  const parent = getParentAddressFromLabels(input.labels, deps.serverId);
  if (parent && parent.serverId === deps.serverId) callers.set(parent.agentId, true);
  for (const caller of deps.subscriptions.watchersOf(input.fromAgentId)) {
    // An agent does not wait on itself, and the agent being left is about to be archived.
    if (caller === input.agentId || caller === input.fromAgentId) continue;
    if (!callers.has(caller)) callers.set(caller, false);
  }
  if (callers.size === 0) return undefined;
  const registrations: FinishRegistration[] = [];
  try {
    for (const [callerAgentId, requireParentOwnership] of callers) {
      registrations.push(
        await deps.subscriptions.register(
          { childAgentId: input.agentId, callerAgentId, requireParentOwnership },
          true,
        ),
      );
    }
  } catch (error) {
    await Promise.allSettled(registrations.map((registration) => registration.reject()));
    throw error;
  }
  return {
    accept() {
      for (const registration of registrations) registration.accept();
    },
    async reject() {
      await Promise.allSettled(registrations.map((registration) => registration.reject()));
    },
  };
}
