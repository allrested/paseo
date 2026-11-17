import { useEffect, useMemo, useRef } from "react";
import type { PluginTheme } from "@getpaseo/plugin";
import type { IncidentsState, Machine } from "../../shared/contracts.js";
import type { OfficeModel } from "../../shared/model.js";
import { onChatAct } from "../chat-acts.js";
import type { FocusRequest } from "../focus-request.js";
import { NO_RESTS, restsAfter, type Rests } from "../pixel/actors.js";
import {
  PLAN_DESKS,
  floorNote,
  isDarkTheme,
  teamOfRoom,
  worldBoardRows,
  worldChanges,
  worldMachine,
  worldPeople,
  withRestTimes,
  type WorldMemory,
  type WorldPlan,
} from "./adapter.js";
import { useIncidentAlarm } from "./use-incident-alarm.js";
import type { WorldApi } from "./world-api.js";

/** The floor everyone works on. The other plan, one open room, has fewer desks. */
export const PLAN: WorldPlan = "pro";

export interface WorldFeedInput {
  model: OfficeModel;
  theme: PluginTheme;
  /** The workspace tab's room; the view starts on its team's desks. */
  focusRoomId: string | null;
  focusRequest: FocusRequest | null;
  /** Whose card is open; the scene marks that person and looks at them. */
  selectedAgentId: string | null;
  /** The host's readings; null when the host has none, and then the server room is furniture. */
  machine: Machine | null;
  /** The stand-up is open: the bell on the meeting table rings once. */
  meeting: boolean;
  incidents: IncidentsState | undefined;
}

/**
 * Feeds a started scene: the people, their events, the board, the machine, the incidents, the
 * theme, the selection and the meeting. `api` is null until the scene has started, and again
 * after it is gone; nothing is sent then. The effects list `api` so the render that starts the
 * scene runs them in the order they are written: the people are seated before the view looks at
 * any. Returns the note about the floor while the scene is up, if any.
 */
export function useWorldFeed(
  api: WorldApi | null,
  {
    model,
    theme,
    focusRoomId,
    focusRequest,
    selectedAgentId,
    machine,
    meeting,
    incidents,
  }: WorldFeedInput,
): { note: string | null } {
  // (a ref for useIncidentAlarm's RefObject; the [api] effect below must stay the first effect)
  const world = useRef<WorldApi | null>(null);
  const memory = useRef<WorldMemory | null>(null);
  // Since when each person rests: the scene sends home whoever rested 30 minutes after 21:00.
  const rests = useRef<Rests>(NO_RESTS);
  useEffect(() => {
    world.current = api;
    return () => {
      world.current = null;
      memory.current = null;
    };
  }, [api]);

  useEffect(() => {
    if (api === null) return;
    world.current?.setTheme({ dark: isDarkTheme(theme.colors), colors: theme.colors });
  }, [theme, api]);

  const people = useMemo(() => worldPeople(model, PLAN_DESKS[PLAN]), [model]);
  useEffect(() => {
    const scene = world.current;
    if (scene === null) return;
    rests.current = restsAfter(rests.current, people.sessions, Date.now());
    scene.setSessions(withRestTimes(people.sessions, rests.current));
    scene.setBoardRows(worldBoardRows(model, people.sessions));
    const changes = worldChanges(memory.current, people);
    for (const event of changes.events) scene.event(event);
    memory.current = changes.memory;
  }, [people, model, api]);

  // After the people: the alarm's bubbles go over whoever is seated at work.
  useIncidentAlarm({ world, started: api !== null, incidents });

  const worldReadings = useMemo(() => worldMachine(machine), [machine]);
  useEffect(() => {
    world.current?.setMachine(worldReadings);
  }, [worldReadings, api]);

  const focusTeam = useMemo(() => teamOfRoom(model, focusRoomId), [model, focusRoomId]);
  useEffect(() => {
    if (focusTeam !== null) world.current?.focusProject(focusTeam);
  }, [focusTeam, api]);

  useEffect(() => {
    world.current?.select(selectedAgentId);
  }, [selectedAgentId, api]);

  useEffect(() => {
    if (meeting) world.current?.meet?.();
  }, [meeting, api]);

  useEffect(
    () =>
      onChatAct((what) => {
        if (what === "meeting") world.current?.gather?.();
      }),
    [],
  );

  // A request that was already there when this view appeared was made for the list view.
  const handledNonce = useRef(focusRequest?.nonce ?? 0);
  useEffect(() => {
    if (focusRequest === null || focusRequest.nonce === handledNonce.current) return;
    handledNonce.current = focusRequest.nonce;
    world.current?.select(focusRequest.agentId);
  }, [focusRequest]);

  return { note: api === null ? null : floorNote(model.agents.size, people.overflow) };
}
