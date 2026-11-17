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
import { useToast } from "@getpaseo/plugin/client/ui";
import {
  notesWriteRpc,
  worldRpc,
  type IncidentsState,
  type Machine,
} from "../../shared/contracts.js";
import { failureText } from "../action-button.js";
import { onChatAct } from "../chat-acts.js";
import type { FocusRequest } from "../focus-request.js";
import type { OfficeModel } from "../../shared/model.js";
import { NO_RESTS, restsAfter, type Rests } from "../pixel/actors.js";
import type { OfficeStyles } from "../styles.js";
import {
  PLAN_DESKS,
  boardRoom,
  floorNote,
  isDarkTheme,
  teamOfRoom,
  worldBoardRows,
  worldBrand,
  worldChanges,
  worldMachine,
  worldPeople,
  withRestTimes,
  type WorldMemory,
  type WorldPlan,
} from "./adapter.js";
import { useIncidentAlarm } from "./use-incident-alarm.js";
import type { WorldApi } from "./world-api.js";
import { readBrand } from "../web-env.web.js";
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
  /**
   * A tap on the server room: its chip, the racks or a server box, and the wall screen while
   * `onOpenResources` is absent.
   */
  onOpenMachine(): void;
  /**
   * A tap on the server room's wall screen where Paseo can show Resources beside the floor;
   * absent where it cannot. Read when the office starts.
   */
  onOpenResources: (() => void) | undefined;
  /**
   * E by a person while walking in: the agent card's "Open session". Absent only where the office
   * has no navigation; with navigation but no side area it opens the agent's workspace, leaving the
   * office, as the card does. Read when the office starts.
   */
  onOpenSession: ((agentId: string) => void) | undefined;
  /** A tap on the library: its chip or the bookshelf. */
  onOpenLibrary(): void;
  /** A tap on the label over the meeting room's screen. */
  onOpenNotes(): void;
  /** The stand-up is open: the bell on the meeting table rings once. */
  meeting: boolean;
  /** The host's incidents: the banner while any is open, and the alarm for one not rung for here. */
  incidents: IncidentsState | undefined;
  /** A tap on the incidents' banner. */
  onOpenIncidents(): void;
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
  onOpenResources,
  onOpenSession,
  onOpenLibrary,
  onOpenNotes,
  meeting,
  incidents,
  onOpenIncidents,
  onProblem,
}: WorldViewProps) {
  const containerId = useId();
  const loadState = useSyncExternalStore(subscribe, read, read);
  const fetchWorld = useRpc(worldRpc);
  const writeNotes = useRpc(notesWriteRpc);
  const toast = useToast();
  // A click on the bell has the stand-up notes written. Whether a writer started is not waited
  // for: the Stand-up card's line says what the writer does.
  const onBell = useCallback(async () => {
    try {
      await writeNotes({});
    } catch (error) {
      toast.error(failureText("Write the stand-up notes", error));
    }
  }, [writeNotes, toast]);
  const world = useRef<WorldApi | null>(null);
  const memory = useRef<WorldMemory | null>(null);
  // Since when each person rests: the scene sends home whoever rested 30 minutes after 21:00.
  const rests = useRef<Rests>(NO_RESTS);
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
    onOpenResources,
    onOpenSession,
    onOpenLibrary,
    onOpenNotes,
    onOpenIncidents,
    onBell,
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
      onOpenResources,
      onOpenSession,
      onOpenLibrary,
      onOpenNotes,
      onOpenIncidents,
      onBell,
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
    onOpenResources,
    onOpenSession,
    onOpenLibrary,
    onOpenNotes,
    onOpenIncidents,
    onBell,
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
          // Read when the office starts: a page's brand does not change while the page lives.
          brand: worldBrand(readBrand()),
          // What these open is Paseo's (a card, a sheet): the keyboard goes with it.
          // A card closed from the scene opens nothing, and Walk in closes the card as it starts:
          // the keyboard stays where it is.
          onSelect: (agentId) => {
            if (agentId !== null) focusApp();
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
          // Given only where Paseo can show Resources: otherwise the scene keeps the wall screen
          // on onMachine, the Host card.
          ...(latest.current.onOpenResources === undefined
            ? {}
            : {
                onResources: () => {
                  focusApp();
                  latest.current.onOpenResources?.();
                },
              }),
          // Given only where the office can open a session (the agent card's "Open session"):
          // otherwise a person under E is chosen, as a click does. The keyboard goes with the
          // session.
          ...(latest.current.onOpenSession === undefined
            ? {}
            : {
                onOpen: (agentId: string) => {
                  focusApp();
                  latest.current.onOpenSession?.(agentId);
                },
              }),
          // The bell opens nothing of Paseo's: the keyboard stays in the office.
          onBell: () => void latest.current.onBell(),
          onNotes: () => {
            focusApp();
            latest.current.onOpenNotes();
          },
          onIncidents: () => {
            focusApp();
            latest.current.onOpenIncidents();
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
    rests.current = restsAfter(rests.current, people.sessions, Date.now());
    api.setSessions(withRestTimes(people.sessions, rests.current));
    api.setBoardRows(worldBoardRows(model, people.sessions));
    const changes = worldChanges(memory.current, people);
    for (const event of changes.events) api.event(event);
    memory.current = changes.memory;
  }, [people, model, started]);

  // After the people: the alarm's bubbles go over whoever is seated at work.
  useIncidentAlarm({ world, started, incidents });

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
