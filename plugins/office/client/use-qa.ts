import { useCallback, useMemo, useState } from "react";
import type { StripCard } from "./attention-strip.js";
import type { OfficeModel } from "./model.js";
import { qaNote, qaTeams, type QaTeam } from "./qa-text.js";

export interface Qa {
  teams: readonly QaTeam[];
  /** The strip's card; null while nothing is under test. */
  entry: StripCard | null;
  open: boolean;
  close(): void;
}

/** What is under test: the teams' pipelines, test runs and scripts, and the card's place in the strip. */
export function useQa(model: OfficeModel, live: boolean): Qa {
  const [opened, setOpened] = useState(false);
  const onOpen = useCallback(() => setOpened(true), []);
  const close = useCallback(() => setOpened(false), []);
  const teams = useMemo(() => qaTeams(model), [model]);
  const entry = useMemo((): StripCard | null => {
    const note = qaNote(teams);
    return note === null ? null : { title: "QA", note, onOpen };
  }, [teams, onOpen]);
  return { teams, entry, open: opened && live, close };
}
