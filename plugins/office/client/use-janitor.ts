import { useCallback } from "react";
import { useRpc } from "@getpaseo/plugin/client";
import { janitorRpc, type JanitorAction } from "../shared/contracts.js";
import { tidyFailure } from "./context-text.js";

/** Rejects with one sentence when the host left the conversation as it is. */
export type Tidy = (agentId: string, action: JanitorAction) => Promise<void>;

/** The call that cleans an agent's context or resets its session. */
export function useJanitor(): Tidy {
  const call = useRpc(janitorRpc);
  return useCallback(
    async (agentId, action) => {
      const result = await call({ agentId, action });
      if (!result.ok) throw new Error(tidyFailure(action, result.error));
    },
    [call],
  );
}
