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
import { assetRpc } from "../../shared/contracts.js";
import type { OfficeModel } from "../model.js";
import type { OfficeStyles } from "../styles.js";
import { createOfficeScene, type KeptCamera, type OfficeScene } from "./office-scene.web.js";
import { scenePalette } from "./palette.js";
import { buildScenePlan } from "./scene-plan.js";
import {
  NO_ROOMS,
  UNMEASURED,
  columnsNow,
  nextLayout,
  shapeAfterResize,
  type ContainerShape,
  type SceneLayoutKeeper,
} from "./scene-layout.js";
import { messageOf, sharedThreeLoader } from "./three-loader.js";
import { evaluateModule, isCoarsePointer, prefersReducedMotion } from "./web-env.web.js";

export interface FocusRequest {
  agentId: string;
  /** Changes on every request, so selecting the same agent twice moves the camera again. */
  nonce: number;
}

export interface SceneViewProps {
  model: OfficeModel;
  theme: PluginTheme;
  styles: OfficeStyles;
  /** The workspace tab's room; the camera starts on it. */
  focusRoomId: string | null;
  focusRequest: FocusRequest | null;
  /**
   * The layout and its memory, kept by the surface: the rooms keep their places when this view
   * goes and comes back (3D off and on, "Try 3D again", a subscription error).
   */
  layoutKeeper: SceneLayoutKeeper;
  /** The camera as the user left it, kept by the surface between two lives of the view. */
  cameraKeeper: SceneCameraKeeper;
  onSelectAgent(agentId: string): void;
  /** A tap on a room's whiteboard or on one of its notes: opens that room's board. */
  onSelectBoard(roomId: string): void;
  /** three.js could not load, the scene could not start, or the WebGL context was lost. */
  onProblem(message: string): void;
}

/** Where the surface keeps the scene's camera between two lives of the view (a React ref). */
export interface SceneCameraKeeper {
  current: KeptCamera | null;
}

const CONTEXT_LOST = "the graphics context was lost";

const subscribe = (listener: () => void) => sharedThreeLoader.subscribe(listener);
const read = () => sharedThreeLoader.state();

/**
 * Web only (office-surface.tsx renders it only on web with WebGL2 and the 3D switch on). The
 * plugin bundle is evaluated on every platform, so nothing here touches the DOM when the module
 * loads. The container and three.js are reached in effects. The two media queries are read once,
 * during the first render, behind the `typeof window` guard in web-env.web.ts.
 *
 * Reporting a problem makes the surface take this view away, and that is what disposes the
 * scene: on unmount, on 3D off and after a lost context alike.
 */
export function SceneView({
  model,
  theme,
  styles,
  focusRoomId,
  focusRequest,
  layoutKeeper,
  cameraKeeper,
  onSelectAgent,
  onSelectBoard,
  onProblem,
}: SceneViewProps) {
  const containerId = useId();
  const loadState = useSyncExternalStore(subscribe, read, read);
  const fetchAsset = useRpc(assetRpc);
  const sceneRef = useRef<OfficeScene | null>(null);
  const handlers = useRef({ onSelectAgent, onSelectBoard, onProblem });
  const [shape, setShape] = useState<ContainerShape>(UNMEASURED);
  const palette = useMemo(() => scenePalette(theme), [theme]);
  const environment = useMemo(
    () => ({ reducedMotion: prefersReducedMotion(), coarsePointer: isCoarsePointer() }),
    [],
  );
  const { sized } = shape;
  const rooms = model.rooms.length;
  // The count in use is read from what the surface keeps: it outlives this view.
  const columns = useMemo(
    () => columnsNow(shape, rooms, layoutKeeper.current.columns),
    [shape, rooms, layoutKeeper],
  );

  useEffect(() => {
    handlers.current = { onSelectAgent, onSelectBoard, onProblem };
  }, [onSelectAgent, onSelectBoard, onProblem]);

  useEffect(() => {
    const container = document.getElementById(containerId);
    if (container === null) return undefined;
    const measure = () => {
      const { clientWidth, clientHeight } = container;
      setShape((previous) => shapeAfterResize(previous, clientWidth, clientHeight));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    measure();
    return () => observer.disconnect();
  }, [containerId]);

  // A tab that was never shown loads nothing. After a failed load the loader keeps its failure
  // until asked again, so the answer is read after this load, not from the render's state.
  const fetchBytes = useCallback(() => fetchAsset({}), [fetchAsset]);
  useEffect(() => {
    if (!sized) return undefined;
    let mounted = true;
    async function load(): Promise<void> {
      await sharedThreeLoader.load({ fetchBytes, evaluate: evaluateModule });
      const state = sharedThreeLoader.state();
      if (mounted && state.status === "failed") handlers.current.onProblem(state.error);
    }
    void load();
    return () => {
      mounted = false;
    };
  }, [fetchBytes, sized]);

  const three = loadState.status === "ready" ? loadState.three : null;
  useEffect(() => {
    if (three === null || !sized) return undefined;
    const container = document.getElementById(containerId);
    if (container === null) return undefined;
    let scene: OfficeScene;
    try {
      scene = createOfficeScene({
        three,
        container,
        ...environment,
        camera: cameraKeeper.current,
        onSelectAgent: (agentId) => handlers.current.onSelectAgent(agentId),
        onSelectBoard: (roomId) => handlers.current.onSelectBoard(roomId),
        onContextLost: () => handlers.current.onProblem(CONTEXT_LOST),
      });
    } catch (error) {
      handlers.current.onProblem(messageOf(error));
      return undefined;
    }
    sceneRef.current = scene;
    return () => {
      sceneRef.current = null;
      // What the user set outlives the scene: 3D off and on, "Try 3D again", an error.
      cameraKeeper.current = scene.camera();
      scene.dispose();
    };
  }, [three, sized, containerId, environment, cameraKeeper]);

  // Effects run in the order they are written. On the render that creates the scene, the room
  // is asked for first and the plan follows, so the first frame is already on the tab's room.
  // `three` and `sized` are listed in both for that render alone.
  useEffect(() => {
    if (focusRoomId !== null) sceneRef.current?.focusRoom(focusRoomId);
  }, [focusRoomId, three, sized]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (scene === null) return;
    const next = nextLayout(layoutKeeper.current, model, columns);
    layoutKeeper.current = next;
    const plan = next.layout === null ? NO_ROOMS : buildScenePlan(model, next.layout, palette);
    scene.update(plan, palette);
  }, [model, columns, palette, three, sized, layoutKeeper]);

  // A request that was already there when this view appeared was made for the structure view.
  const handledNonce = useRef(focusRequest?.nonce ?? 0);
  useEffect(() => {
    if (focusRequest === null || focusRequest.nonce === handledNonce.current) return;
    handledNonce.current = focusRequest.nonce;
    sceneRef.current?.focusAgent(focusRequest.agentId);
  }, [focusRequest]);

  return (
    <View id={containerId} style={styles.scene}>
      {three === null ? <Text style={styles.sceneStatus}>Loading the 3D view...</Text> : null}
    </View>
  );
}
