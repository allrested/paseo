import { useCallback, useEffect, useMemo, useState } from "react";
import { useRpc } from "@getpaseo/plugin/client";
import { skillsRpc, type SkillsResult } from "../shared/contracts.js";
import { failureText } from "./action-button.js";
import type { StripCard } from "./attention-strip.js";
import { libraryNote, libraryTeams, skillAsk, type LibraryTeam } from "./library-text.js";
import type { OfficeModel } from "./model.js";
import type { BoardActions } from "./use-board-actions.js";

export interface Library {
  teams: readonly LibraryTeam[];
  /** The last reading of the skills; null before the first. */
  skills: SkillsResult | null;
  /** Why the last reading failed; null when it did not. */
  readFailure: string | null;
  /** The strip's card; null in an office without a team. */
  entry: StripCard | null;
  open: boolean;
  /** Reads the skills again; a failure is kept in `readFailure`. */
  read(): Promise<void>;
  /** Posts the request for a skill on the team's board, naming the agent. */
  teach(team: LibraryTeam, agentId: string, topic: string): Promise<void>;
  /** Leaves the card for the room's board, which has the answer in full. */
  openBoard(roomId: string): void;
  close(): void;
}

export interface LibraryInput {
  model: OfficeModel;
  post: BoardActions["post"];
  live: boolean;
  showBoard(roomId: string): void;
}

/** The library: the skills, who is at a skill, the card's place in the strip, and the request for a skill. */
export function useLibrary({ model, post, live, showBoard }: LibraryInput): Library {
  const call = useRpc(skillsRpc);
  const [opened, setOpened] = useState(false);
  const [skills, setSkills] = useState<SkillsResult | null>(null);
  const [readFailure, setReadFailure] = useState<string | null>(null);
  const onOpen = useCallback(() => setOpened(true), []);
  const close = useCallback(() => setOpened(false), []);
  const read = useCallback(async () => {
    setReadFailure(null);
    try {
      setSkills(await call({}));
    } catch (error) {
      setReadFailure(failureText("Read the skills", error));
    }
  }, [call]);
  const open = opened && live;
  // Read on every opening: a skill an agent wrote since shows without a press.
  useEffect(() => {
    if (open) void read();
  }, [open, read]);
  const teams = useMemo(() => libraryTeams(model, skills), [model, skills]);
  const entry = useMemo((): StripCard | null => {
    const note = libraryNote(teams);
    return note === null ? null : { title: "Library", note, onOpen };
  }, [teams, onOpen]);
  const teach = useCallback(
    async (team: LibraryTeam, agentId: string, topic: string) => {
      const provider = model.agents.get(agentId)?.provider ?? "";
      await post({
        board: team.roomId,
        kind: "note",
        text: skillAsk(topic, provider),
        to: agentId,
      });
    },
    [model.agents, post],
  );
  const openBoard = useCallback(
    (roomId: string) => {
      setOpened(false);
      showBoard(roomId);
    },
    [showBoard],
  );
  return { teams, skills, readFailure, entry, open, read, teach, openBoard, close };
}
