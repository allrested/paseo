import { useMemo } from "react";
import { usePaseo } from "@getpaseo/plugin/client";
import { extra } from "../shared/host-extras.js";

export interface AgentActions {
  send(agentId: string, text: string): Promise<void>;
  respond(agentId: string, requestId: string, allow: boolean): Promise<void>;
  /** Stops the running turn; null where the host's SDK has no cancel(), so no Stop is offered. */
  cancel: ((agentId: string) => Promise<void>) | null;
}

export function useAgentActions(): AgentActions {
  const paseo = usePaseo();
  return useMemo((): AgentActions => {
    // `agents.ref` sends nothing, so a made-up id is enough to ask whether the handle can cancel.
    const canCancel = extra(paseo.agents.ref("probe"), "cancel") !== null;
    return {
      send: (agentId, text) => paseo.agents.ref(agentId).send(text),
      respond: (agentId, requestId, allow) =>
        paseo.agents.ref(agentId).respondToPermission({
          requestId,
          response: allow ? { behavior: "allow" } : { behavior: "deny" },
        }),
      cancel: canCancel ? (agentId) => extra(paseo.agents.ref(agentId), "cancel")!() : null,
    };
  }, [paseo]);
}
