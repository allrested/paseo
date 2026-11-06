import { useCallback, useMemo } from "react";
import { skipToken, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useFetchQuery } from "@/data/query";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import type { MoveRequest } from "./move-model";
import { moveTargetsRecheckMs, resolveMoveTargetsView } from "./move-targets";

export type AgentMoveStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string };

export interface MoveBackRequest {
  continueWork: boolean;
}

type AgentMoveMutation =
  | ({ kind: "move" } & MoveRequest)
  | ({ kind: "move-back" } & MoveBackRequest);

// Usage behind the targets moves on the order of minutes; a reopen within that reuses the list.
const MOVE_TARGETS_STALE_TIME_MS = 30_000;

function agentMoveTargetsQueryKey(serverId: string, agentId: string) {
  return ["agent-move-targets", serverId, agentId] as const;
}

/** Whether a host can move agents. Every move surface is gated on this. */
export function useSupportsAgentMove(serverId: string): boolean {
  return useHostFeature(serverId, "agentMove");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface UseAgentMoveInput {
  serverId: string;
  agentId: string;
  targetsEnabled: boolean;
  /** While set, the targets are read again until this provider's account is under its limit. */
  recheckProvider: string | null;
  /** Runs once the host has moved the agent, with the agent that now holds the session. */
  onMoved?: (agentId: string) => void;
}

/**
 * The move targets of one agent and the requests that move it. `targetsEnabled` decides whether
 * the targets are fetched, so a surface that only shows them on demand costs nothing until then.
 */
export function useAgentMove(input: UseAgentMoveInput) {
  const { serverId, agentId, targetsEnabled, recheckProvider, onMoved } = input;
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const supported = useSupportsAgentMove(serverId);
  const canMove = Boolean(client && isConnected && supported);

  const targetsQuery = useFetchQuery({
    queryKey: agentMoveTargetsQueryKey(serverId, agentId),
    queryFn: client ? () => client.listMoveTargets(agentId) : skipToken,
    enabled: canMove && targetsEnabled,
    dataShape: "list",
    staleTimeMs: MOVE_TARGETS_STALE_TIME_MS,
    // Re-evaluated after each fetch, so the poll stops once the account is under its limit.
    refetchInterval: recheckProvider
      ? (query) => moveTargetsRecheckMs(query.state.data, recheckProvider)
      : false,
    // A refusal from the host is final; show it instead of retrying behind "Loading...".
    retry: false,
  });

  const mutation = useMutation({
    mutationFn: (request: AgentMoveMutation) => {
      if (!client) throw new Error(t("sessionMove.hostDisconnected"));
      if (request.kind === "move") {
        return client.moveAgent(
          agentId,
          {
            provider: request.target.provider,
            ...(request.model ? { model: request.model } : {}),
          },
          { continueWork: request.continueWork },
        );
      }
      return client.moveAgentBack(agentId, { continueWork: request.continueWork });
    },
    onSuccess: (outcome) => onMoved?.(outcome.agentId),
  });
  const { mutate } = mutation;

  const move = useCallback(
    (request: MoveRequest) => mutate({ kind: "move", ...request }),
    [mutate],
  );
  const moveBack = useCallback(
    (request: MoveBackRequest) => mutate({ kind: "move-back", ...request }),
    [mutate],
  );

  const targets = useMemo(
    () =>
      resolveMoveTargetsView({
        canRequest: canMove,
        data: targetsQuery.data,
        error: targetsQuery.error,
      }),
    [canMove, targetsQuery.data, targetsQuery.error],
  );

  const status = useMemo((): AgentMoveStatus => {
    if (mutation.isPending) return { kind: "loading" };
    if (mutation.isError) return { kind: "error", message: errorMessage(mutation.error) };
    return { kind: "idle" };
  }, [mutation.error, mutation.isError, mutation.isPending]);

  return { canMove, targets, move, moveBack, status };
}
