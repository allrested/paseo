import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { worldRpc, type Machine } from "../../shared/contracts.js";
import type { FocusRequest } from "../focus-request.js";
import type { OfficeModel } from "../model.js";
import type { OfficeStyles } from "../styles.js";
import {
  PLAN_DESKS,
  boardRoom,
  floorNote,
  isDarkTheme,
  teamOfRoom,
  worldBoardRows,
  worldChanges,
  worldMachine,
  worldPeople,
  type WorldMemory,
  type WorldPlan,
} from "./adapter.js";
import type { WorldApi } from "./world-api.js";
import { focusApp, openWorldFrame } from "./world-frame.web.js";
import { messageOf, sharedWorldLoader } from "./world-loader.js";

export interface WorldViewProps {
  model: OfficeModel;
  theme: PluginTheme;
  styles: OfficeStyles;
  /** The workspace tab's room; the view starts on its team's desks. */
  focusRoomId: string | null;
  focusRequest: FocusRequest | null;
  /** Whose card is open; the scene marks that person and looks at them. */
  selectedAgentId: string | null;
  /** A tap on a person, or null when the same person is tapped again. */
  onSelectAgent(agentId: string | null): void;
  /** A tap on a team's chip or on the whiteboard: opens that room's board. */
  onSelectBoard(roomId: string): void;
  /** The host's readings; null when the host has none, and then the server room is furniture. */
  machine: Machine | null;
  /** A tap on the server room: its chip, the racks, the wall screen or a server box. */
  onOpenMachine(): void;
  /** A tap on the library: its chip or the bookshelf. */
  onOpenLibrary(): void;
  /** The stand-up is open: the bell on the meeting table rings once. */
  meeting: boolean;
  /** The script could not load, the office could not start, or the WebGL context was lost. */
  onProblem(message: string): void;
}

/** The floor everyone works on. The other plan, one open room, has fewer desks. */
const PLAN: WorldPlan = "pro";

const subscribe = (listener: () => void) => sharedWorldLoader.subscribe(listener);
const read = () => sharedWorldLoader.state();

/**
 * The office in 3D. Web only: office-surface.tsx renders it in a browser with WebGL2 where 3D is
 * the chosen view. The plugin bundle is evaluated on every platform, so the container and the
 * frame are reached in effects and nothing here touches the DOM when the module loads.
 *
 * Reporting a problem makes the surface take this view away, and that removes the frame: on
 * unmount, on another view chosen and after a lost context alike.
 */
export function WorldView({
  model,
  theme,
  styles,
  focusRoomId,
  focusRequest,
  selectedAgentId,
  onSelectAgent,
  onSelectBoard,
  machine,
  onOpenMachine,
  onOpenLibrary,
  meeting,
  onProblem,
}: WorldViewProps) {
  const containerId = useId();
  const loadState = useSyncExternalStore(subscribe, read, read);
  const fetchWorld = useRpc(worldRpc);
  const world = useRef<WorldApi | null>(null);
  const memory = useRef<WorldMemory | null>(null);
  const [sized, setSized] = useState(false);
  const [started, setStarted] = useState(false);
  // What the frame's callbacks and its start read: always the last render's.
  const latest = useRef({
    model,
    theme,
    focusRoomId,
    selectedAgentId,
    onSelectAgent,
    onSelectBoard,
    onOpenMachine,
    onOpenLibrary,
    onProblem,
  });
  useEffect(() => {
    latest.current = {
      model,
      theme,
      focusRoomId,
      selectedAgentId,
      onSelectAgent,
      onSelectBoard,
      onOpenMachine,
      onOpenLibrary,
      onProblem,
    };
  }, [
    model,
    theme,
    focusRoomId,
    selectedAgentId,
    onSelectAgent,
    onSelectBoard,
    onOpenMachine,
    onOpenLibrary,
    onProblem,
  ]);

  // A tab that was never shown has no size: it loads nothing and starts nothing.
  useEffect(() => {
    const container = document.getElementById(containerId);
    if (container === null) return undefined;
    const measure = () => {
      if (container.clientWidth > 0 && container.clientHeight > 0) setSized(true);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    measure();
    return () => observer.disconnect();
  }, [containerId]);

  // After a failed load the loader keeps its failure until asked again, so the answer is read
  // after this load, not from the render's state.
  const fetchScript = useCallback(() => fetchWorld({}), [fetchWorld]);
  useEffect(() => {
    if (!sized) return undefined;
    let mounted = true;
    async function load(): Promise<void> {
      await sharedWorldLoader.load(fetchScript);
      const state = sharedWorldLoader.state();
      if (mounted && state.status === "failed") latest.current.onProblem(state.error);
    }
    void load();
    return () => {
      mounted = false;
    };
  }, [fetchScript, sized]);

  const script = loadState.status === "ready" ? loadState.script : null;
  useEffect(() => {
    if (script === null || !sized) return undefined;
    const container = document.getElementById(containerId);
    if (container === null) return undefined;
    let live = true;
    const frame = openWorldFrame({ container, script, title: "Office in 3D" });
    function start(api: WorldApi): void {
      if (!live) return;
      const { colors } = latest.current.theme;
      try {
        api.start({
          plan: PLAN,
          dark: isDarkTheme(colors),
          colors,
          // What these open is Paseo's (a card, a sheet): the keyboard goes with it.
          onSelect: (agentId) => {
            focusApp();
            latest.current.onSelectAgent(agentId);
          },
          onBoard: (project) => {
            focusApp();
            const now = latest.current;
            const roomId = boardRoom(now.model, {
              project,
              focusRoomId: now.focusRoomId,
              selectedAgentId: now.selectedAgentId,
            });
            if (roomId !== null) now.onSelectBoard(roomId);
          },
          onMachine: () => {
            focusApp();
            latest.current.onOpenMachine();
          },
          onLibrary: () => {
            focusApp();
            latest.current.onOpenLibrary();
          },
          onProblem: (message) => latest.current.onProblem(message),
        });
      } catch (error) {
        latest.current.onProblem(messageOf(error));
        return;
      }
      world.current = api;
      setStarted(true);
    }
    frame.api.then(start, (error: unknown) => {
      if (live) latest.current.onProblem(messageOf(error));
    });
    return () => {
      live = false;
      world.current = null;
      memory.current = null;
      setStarted(false);
      frame.dispose();
    };
  }, [script, sized, containerId]);

  // `started` is listed in the effects below for the render that starts the office alone: they
  // run in the order they are written, so the people are seated before the view looks at any.
  useEffect(() => {
    if (!started) return;
    world.current?.setTheme({ dark: isDarkTheme(theme.colors), colors: theme.colors });
  }, [theme, started]);

  const people = useMemo(() => worldPeople(model, PLAN_DESKS[PLAN]), [model]);
  useEffect(() => {
    const api = world.current;
    if (api === null) return;
    api.setSessions(people.sessions);
    api.setBoardRows(worldBoardRows(model, people.sessions));
    const changes = worldChanges(memory.current, people);
    for (const event of changes.events) api.event(event);
    memory.current = changes.memory;
  }, [people, model, started]);

  const worldReadings = useMemo(() => worldMachine(machine), [machine]);
  useEffect(() => {
    world.current?.setMachine(worldReadings);
  }, [worldReadings, started]);

  const focusTeam = useMemo(() => teamOfRoom(model, focusRoomId), [model, focusRoomId]);
  useEffect(() => {
    if (focusTeam !== null) world.current?.focusProject(focusTeam);
  }, [focusTeam, started]);

  useEffect(() => {
    world.current?.select(selectedAgentId);
  }, [selectedAgentId, started]);

  useEffect(() => {
    if (meeting) world.current?.meet?.();
  }, [meeting, started]);

  // A request that was already there when this view appeared was made for the list view.
  const handledNonce = useRef(focusRequest?.nonce ?? 0);
  useEffect(() => {
    if (focusRequest === null || focusRequest.nonce === handledNonce.current) return;
    handledNonce.current = focusRequest.nonce;
    world.current?.select(focusRequest.agentId);
  }, [focusRequest]);

  const note = floorNote(model.agents.size, people.overflow);
  return (
    <View id={containerId} style={styles.scene}>
      {started ? null : <Text style={styles.sceneStatus}>Loading the 3D view...</Text>}
      {started && note !== null ? (
        <View style={styles.sceneNote}>
          <Text style={styles.sceneNoteText}>{note}</Text>
        </View>
      ) : null}
    </View>
  );
}
