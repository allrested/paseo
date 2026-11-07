import { create } from "zustand";
import type { UsageHeadsUpDismissal } from "./usage-heads-up";

export interface UsageHeadsUpState {
  /** Keyed by host and account window. In memory only: an app restart shows each heads-up again. */
  dismissals: Record<string, UsageHeadsUpDismissal>;
}

export const useUsageHeadsUpStore = create<UsageHeadsUpState>(() => ({ dismissals: {} }));

function dismissalKey(input: { serverId: string; windowKey: string }): string {
  return `${input.serverId}\n${input.windowKey}`;
}

export function dismissUsageHeadsUp(input: {
  serverId: string;
  windowKey: string;
  dismissal: UsageHeadsUpDismissal;
}): void {
  useUsageHeadsUpStore.setState((state) => ({
    dismissals: { ...state.dismissals, [dismissalKey(input)]: input.dismissal },
  }));
}

export function selectUsageHeadsUpDismissal(
  state: UsageHeadsUpState,
  input: { serverId: string; windowKey: string | null },
): UsageHeadsUpDismissal | null {
  if (input.windowKey === null) return null;
  return (
    state.dismissals[dismissalKey({ serverId: input.serverId, windowKey: input.windowKey })] ?? null
  );
}
