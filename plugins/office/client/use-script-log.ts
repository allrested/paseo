import { useCallback } from "react";
import { useRpc } from "@getpaseo/plugin/client";
import { scriptLogRpc } from "../shared/contracts.js";

/** The end of a script's output as the host read it. */
export interface ScriptLog {
  lines: readonly string[];
  /** Rows of output above these that the terminal still holds. */
  earlier: number;
  readAt: string;
}

/** Rejects with one sentence when the host has no output to give. */
export type ReadScriptLog = (workspaceId: string, script: string) => Promise<ScriptLog>;

/** The call that reads the end of a workspace script's output. */
export function useScriptLog(): ReadScriptLog {
  const call = useRpc(scriptLogRpc);
  return useCallback(
    async (workspaceId, script) => {
      const result = await call({ workspaceId, script });
      if (!result.ok) throw new Error(result.error);
      return { lines: result.lines, earlier: result.earlier, readAt: result.readAt };
    },
    [call],
  );
}
