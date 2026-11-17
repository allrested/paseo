import { useCallback } from "react";
import { useRpc } from "@getpaseo/plugin/client";
import { incidentsDismissRpc } from "../shared/contracts.js";

/** Rejects when the host did not dismiss them. No ids dismisses every open incident. */
export type DismissIncidents = (ids?: string[]) => Promise<void>;

/** The call that dismisses open incidents: the named ones, or all of them. */
export function useIncidents(): DismissIncidents {
  const call = useRpc(incidentsDismissRpc);
  return useCallback(
    async (ids) => {
      await call(ids === undefined ? {} : { ids });
    },
    [call],
  );
}
