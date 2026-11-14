import type { FinishRegistration } from "../finish-subscriptions/index.js";
import type { TargetLogin } from "./target-login.js";
import type { WatcherNoticeInput } from "./watcher-notice.js";

/**
 * What a session move needs from outside the agent itself. The daemon sets one on the agent
 * manager at startup; a manager without one, as in unit tests, moves without it.
 */
export interface MoveCarry {
  /** Points not-completed schedules aimed at `from` at `to`. */
  retargetSchedules(from: string, to: string): Promise<string[]>;
  /**
   * Registers a finish notification from the agent a move hands to, for the parent and the
   * other agents on this host that waited on the agent it leaves. Held until `accept()`.
   * Undefined when there is nobody to tell.
   */
  notifyWatchersOnFinish(input: WatcherNoticeInput): Promise<FinishRegistration | undefined>;
  /** Whether the login `providerId` launches with is signed in, as its own CLI says. */
  targetLogin(providerId: string): Promise<TargetLogin>;
}
