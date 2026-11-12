import { useMemo } from "react";
import { useRpc } from "@getpaseo/plugin/client";
import {
  deleteRpc,
  postRpc,
  setWakesPausedRpc,
  updateRpc,
  type PostKind,
} from "../shared/contracts.js";

export interface BoardActions {
  post(input: { board: string; kind: PostKind; text: string; to?: string }): Promise<void>;
  markDone(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  setWakesPaused(paused: boolean): Promise<void>;
}

/** Each action rejects with the server's message, which ActionButton shows under the button. */
export function useBoardActions(): BoardActions {
  const post = useRpc(postRpc);
  const update = useRpc(updateRpc);
  const remove = useRpc(deleteRpc);
  const pause = useRpc(setWakesPausedRpc);
  return useMemo(
    (): BoardActions => ({
      async post(input) {
        const result = await post(input);
        if (!result.ok) throw new Error(result.error);
      },
      async markDone(id) {
        const result = await update({ id, action: "done" });
        if (!result.ok) throw new Error(result.error);
      },
      async remove(id) {
        const result = await remove({ id });
        if (!result.ok) throw new Error(result.error);
      },
      async setWakesPaused(paused) {
        await pause({ paused });
      },
    }),
    [post, update, remove, pause],
  );
}
