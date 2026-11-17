import { useEffect, useId, useRef, useState } from "react";
import { Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import type { IncidentsState, Machine } from "../../shared/contracts.js";
import type { FocusRequest } from "../focus-request.js";
import type { OfficeModel } from "../../shared/model.js";
import type { OfficeStyles } from "../styles.js";
import { worldBrand } from "./adapter.js";
import { useWorldFeed } from "./use-world-feed.js";
import type { WorldApi } from "./world-api.js";
import { readBrand } from "../web-env.web.js";
import { focusApp, openWorldFrame } from "./world-frame.web.js";
import { messageOf } from "./world-loader.js";
import {
  useStandupBell,
  useWorldScript,
  worldStartOptions,
  type WorldLatest,
} from "./world-view-shared.js";

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
  const onBell = useStandupBell();
  const [sized, setSized] = useState(false);
  const [api, setApi] = useState<WorldApi | null>(null);
  // What the frame's callbacks and its start read: always the last render's.
  const latest = useRef<WorldLatest>({
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

  const script = useWorldScript(sized, onProblem);
  useEffect(() => {
    if (script === null || !sized) return undefined;
    const container = document.getElementById(containerId);
    if (container === null) return undefined;
    let live = true;
    const frame = openWorldFrame({ container, script, title: "Office in 3D" });
    function start(scene: WorldApi): void {
      if (!live) return;
      try {
        scene.start(
          worldStartOptions(latest, {
            focus: focusApp,
            // Read when the office starts: a page's brand does not change while the page lives.
            brand: worldBrand(readBrand()),
          }),
        );
      } catch (error) {
        latest.current.onProblem(messageOf(error));
        return;
      }
      setApi(scene);
    }
    frame.api.then(start, (error: unknown) => {
      if (live) latest.current.onProblem(messageOf(error));
    });
    return () => {
      live = false;
      setApi(null);
      frame.dispose();
    };
  }, [script, sized, containerId]);

  const { note } = useWorldFeed(api, {
    model,
    theme,
    focusRoomId,
    focusRequest,
    selectedAgentId,
    machine,
    meeting,
    incidents,
  });
  return (
    <View id={containerId} style={styles.scene}>
      {api === null ? <Text style={styles.sceneStatus}>Loading the 3D view...</Text> : null}
      {api !== null && note !== null ? (
        <View style={styles.sceneNote}>
          <Text style={styles.sceneNoteText}>{note}</Text>
        </View>
      ) : null}
    </View>
  );
}
