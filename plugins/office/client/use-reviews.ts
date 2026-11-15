import { useCallback, useMemo, useState } from "react";
import type { StripCard } from "./attention-strip.js";
import type { OfficeModel } from "./model.js";
import { reviewAsk, reviewNote, reviewRows, type ReviewRow } from "./review-text.js";
import type { BoardActions } from "./use-board-actions.js";

export interface Reviews {
  rows: readonly ReviewRow[];
  /** The strip's card; null while no pull request is open. */
  entry: StripCard | null;
  open: boolean;
  /** Posts the request for a review on the pull request's board, naming the row's reviewer. */
  ask(row: ReviewRow): Promise<void>;
  /** Leaves the card for the workspace, where the app has the diff; undefined where the host cannot. */
  openWorkspace: ((workspaceId: string) => void) | undefined;
  /** Leaves the card for the room's board, which has the review in full. */
  openBoard(roomId: string): void;
  close(): void;
}

export interface ReviewsInput {
  model: OfficeModel;
  post: BoardActions["post"];
  live: boolean;
  /** The host's way to a workspace; undefined on a host without one. */
  showWorkspace: ((workspaceId: string) => void) | undefined;
  showBoard(roomId: string): void;
}

/** The review queue: its rows, its card's place in the strip, and the ways on from the card. */
export function useReviews({ model, post, live, showWorkspace, showBoard }: ReviewsInput): Reviews {
  const [opened, setOpened] = useState(false);
  const onOpen = useCallback(() => setOpened(true), []);
  const close = useCallback(() => setOpened(false), []);
  const rows = useMemo(() => reviewRows(model), [model]);
  const entry = useMemo((): StripCard | null => {
    const note = reviewNote(rows);
    return note === null ? null : { title: "Reviews", note, onOpen };
  }, [rows, onOpen]);
  const ask = useCallback(
    async (row: ReviewRow) => {
      const request = model.rooms.find((room) => room.id === row.roomId)?.workspace?.pullRequest;
      if (!request || row.reviewer === null) return;
      await post({
        board: row.roomId,
        kind: "note",
        text: reviewAsk(request),
        to: row.reviewer.agentId,
      });
    },
    [model.rooms, post],
  );
  const openWorkspace = useMemo(() => {
    if (showWorkspace === undefined) return undefined;
    return (workspaceId: string) => {
      setOpened(false);
      showWorkspace(workspaceId);
    };
  }, [showWorkspace]);
  const openBoard = useCallback(
    (roomId: string) => {
      setOpened(false);
      showBoard(roomId);
    },
    [showBoard],
  );
  return { rows, entry, open: opened && live, ask, openWorkspace, openBoard, close };
}
