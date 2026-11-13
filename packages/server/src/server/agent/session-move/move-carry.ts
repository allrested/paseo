import type { FinishRegistration } from "../finish-subscriptions/index.js";
import type { TargetLogin } from "./target-login.js";

/**
 * What a session move needs from outside the agent itself. The daemon sets one on the agent
 * manager at startup; a manager without one, as in unit tests, moves without it.
 */
export interface MoveCarry {
  /** Points not-completed schedules aimed at `from` at `to`. */
  retargetSchedules(from: string, to: string): Promise<string[]>;
  /**
   * Registers a finish notification from `agentId` to its parent, held until `accept()`.
   * Undefined when the labels name no parent, or a parent on another host.
   */
  notifyParentOnFinish(
    agentId: string,
    labels: Record<string, string>,
  ): Promise<FinishRegistration | undefined>;
  /** Whether the login `providerId` launches with is signed in, as its own CLI says. */
  targetLogin(providerId: string): Promise<TargetLogin>;
}
