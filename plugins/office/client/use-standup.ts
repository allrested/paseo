import { useCallback, useMemo, useState } from "react";
import type { StripCard } from "./attention-strip.js";
import type { OfficeModel } from "../shared/model.js";
import {
  STANDUP_ASK,
  standupNote,
  standupTeams,
  type StandupTeam,
} from "../shared/standup-text.js";
import type { BoardActions } from "./use-board-actions.js";

export interface Standup {
  teams: readonly StandupTeam[];
  /** The strip's card; null in an office without agents. */
  entry: StripCard | null;
  /** The card is open, and so the floor is at its stand-up. */
  open: boolean;
  /** The clock the stand-up reads: when its card opened, and the office's first draw before. */
  at: number;
  /** Posts the request for an update on a team's board, naming one agent. */
  ask(roomId: string, agentId: string): Promise<void>;
  close(): void;
}

/** The stand-up: the report, its card's place in the strip, and the request for updates. */
export function useStandup(model: OfficeModel, post: BoardActions["post"], live: boolean): Standup {
  // The stand-up reads the clock when it opens: a note counts for a day.
  const [openedAt, setOpenedAt] = useState<number | null>(null);
  const [mountedAt] = useState(() => Date.now());
  const onOpen = useCallback(() => setOpenedAt(Date.now()), []);
  const close = useCallback(() => setOpenedAt(null), []);
  const teams = useMemo(
    () => standupTeams(model, openedAt ?? mountedAt),
    [model, openedAt, mountedAt],
  );
  const entry = useMemo((): StripCard | null => {
    const note = standupNote(teams);
    return note === null ? null : { title: "Stand-up", note, onOpen };
  }, [teams, onOpen]);
  const ask = useCallback(
    (roomId: string, agentId: string) =>
      post({ board: roomId, kind: "note", text: STANDUP_ASK, to: agentId }),
    [post],
  );
  return { teams, entry, open: openedAt !== null && live, at: openedAt ?? mountedAt, ask, close };
}
