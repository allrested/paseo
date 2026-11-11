import { useMemo } from "react";
import { usePaseo } from "@getpaseo/plugin/client";

export interface AgentActions {
  send(agentId: string, text: string): Promise<void>;
  respond(agentId: string, requestId: string, allow: boolean): Promise<void>;
  /** Stops the running turn (the SDK's cancel(), added for the office). */
  cancel(agentId: string): Promise<void>;
}

export function useAgentActions(): AgentActions {
  const paseo = usePaseo();
  return useMemo(
    (): AgentActions => ({
      send: (agentId, text) => paseo.agents.ref(agentId).send(text),
      respond: (agentId, requestId, allow) =>
        paseo.agents.ref(agentId).respondToPermission({
          requestId,
          response: allow ? { behavior: "allow" } : { behavior: "deny" },
        }),
      cancel: (agentId) => paseo.agents.ref(agentId).cancel(),
    }),
    [paseo],
  );
}
