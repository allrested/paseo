// The 3D view drawn on the host, for a device that cannot draw it: the installed app, and a
// browser without WebGL2. It shows the host's latest picture and sends touches back. Everything
// here is a React Native primitive: the store app evaluates this bundle as it is.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  AppState,
  Image,
  PixelRatio,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc, useSubscription } from "@getpaseo/plugin/client";
import {
  renderInputRpc,
  renderSubscription,
  type RenderEvent,
  type RenderInput,
} from "../../shared/contracts.js";
import type { OfficeStyles } from "../styles.js";
import type { FocusRequest } from "./scene-view.js";
import { MOVE_INTERVAL_MS, createStreamGesture, type StreamTouch } from "./stream-gesture.js";
import { createStreamOutbox } from "./stream-outbox.js";
import { INITIAL_STREAM, streamReducer } from "./use-render-stream.js";

/** The host closes a stream that hears nothing for 30 seconds. */
export const KEEP_ALIVE_MS = 10_000;
const HOST_CLOSED = "the host closed the 3D view";

export interface StreamViewProps {
  theme: PluginTheme;
  styles: OfficeStyles;
  /** Whether the device is touched, not pointed at: the scene picks with a wider reach. */
  coarsePointer: boolean;
  /** The workspace tab's room; the camera starts on it. */
  focusRoomId: string | null;
  focusRequest: FocusRequest | null;
  onSelectAgent(agentId: string): void;
  onSelectBoard(roomId: string): void;
  /** The stream could not start or has ended. */
  onProblem(message: string): void;
}

interface Size {
  width: number;
  height: number;
}

/**
 * The view's size, or null while it has none. A hidden workspace tab measures 0 x 0: its stream
 * closes, so a view nobody sees holds none of the host's two places.
 */
export function sizeAfterLayout(previous: Size | null, width: number, height: number): Size | null {
  if (width < 1 || height < 1) return null;
  if (previous !== null && previous.width === width && previous.height === height) return previous;
  return { width, height };
}

/** The stream runs only for a view that has a size, in an app that is not in the background. */
export function streamShown(size: Size | null, appState: string): size is Size {
  return size !== null && appState !== "background";
}

/** The size to tell the host, or null when it already has it. */
export function resizeToSend(sent: Size, now: Size): Size | null {
  return sent.width === now.width && sent.height === now.height ? null : now;
}

export function StreamView(props: StreamViewProps) {
  const { styles } = props;
  const [size, setSize] = useState<Size | null>(null);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((previous) => sizeAfterLayout(previous, width, height));
  }, []);
  const [appState, setAppState] = useState<string>(() => AppState.currentState);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", setAppState);
    return () => subscription.remove();
  }, []);
  // A new theme is a new stream: the host draws in the colours it was opened with.
  const themeKey = useMemo(() => Object.values(props.theme.colors).join("|"), [props.theme]);
  return (
    <View style={styles.scene} onLayout={onLayout}>
      {streamShown(size, appState) ? (
        <Stream key={themeKey} size={size} {...props} />
      ) : (
        <Text style={styles.sceneStatus}>Loading the 3D view...</Text>
      )}
    </View>
  );
}

function Stream({
  size,
  theme,
  styles,
  coarsePointer,
  focusRoomId,
  focusRequest,
  onSelectAgent,
  onSelectBoard,
  onProblem,
}: StreamViewProps & { size: Size }) {
  // The stream opens at the first size; later sizes go to the host as a resize, because a new
  // subscription input would open a new page.
  const [input] = useState<RenderInput>(() => ({
    width: size.width,
    height: size.height,
    pixelRatio: PixelRatio.get(),
    colors: theme.colors,
    coarsePointer,
    ...(focusRoomId === null ? {} : { focusRoomId }),
  }));
  const [state, dispatch] = useReducer(streamReducer, INITIAL_STREAM);
  const handlers = useRef({ onSelectAgent, onSelectBoard, onProblem });
  useEffect(() => {
    handlers.current = { onSelectAgent, onSelectBoard, onProblem };
  }, [onSelectAgent, onSelectBoard, onProblem]);

  const send = useRpc(renderInputRpc);
  const outbox = useMemo(
    () => createStreamOutbox({ send, onLost: (reason) => handlers.current.onProblem(reason) }),
    [send],
  );
  useEffect(() => () => outbox.stop(), [outbox]);

  const onEvent = useCallback(
    (event: RenderEvent) => {
      dispatch(event);
      if (event.type === "ready") outbox.ready(event.streamId);
      else if (event.type === "picture") outbox.shown(event.seq);
      else if (event.type === "problem") handlers.current.onProblem(event.message);
      else if (event.target === "agent") handlers.current.onSelectAgent(event.id);
      else handlers.current.onSelectBoard(event.id);
    },
    [outbox],
  );
  const subscription = useSubscription(renderSubscription, input, onEvent);
  const { status } = subscription;
  const failure = subscription.status === "error" ? subscription.error.message : null;
  const { problem } = state;
  useEffect(() => {
    if (failure !== null) handlers.current.onProblem(failure);
    // The host says why before it closes a stream; a close with no reason is one too.
    else if (status === "closed" && problem === null) handlers.current.onProblem(HOST_CLOSED);
  }, [status, failure, problem]);

  useEffect(() => {
    const timer = setInterval(() => outbox.keepAlive(), KEEP_ALIVE_MS);
    return () => clearInterval(timer);
  }, [outbox]);

  // Compared with the last size the host was told, not the opening one: turning the phone and
  // turning it back has to send the opening size again. A new stream on this view, as after a
  // reconnect, has a new page at the opening size, so what the old one was told counts no more.
  const hostSize = useRef<Size & { streamId: string | null }>({
    streamId: null,
    width: input.width,
    height: input.height,
  });
  const { streamId } = state;
  const { width, height } = size;
  useEffect(() => {
    if (streamId === null) return;
    if (hostSize.current.streamId !== streamId) {
      hostSize.current = { streamId, width: input.width, height: input.height };
    }
    const next = resizeToSend(hostSize.current, { width, height });
    if (next === null) return;
    hostSize.current = { streamId, ...next };
    outbox.resize({ ...next, pixelRatio: input.pixelRatio });
  }, [streamId, width, height, input, outbox]);

  // A request that was already there when this view appeared was made for the structure view.
  const handledNonce = useRef(focusRequest?.nonce ?? 0);
  useEffect(() => {
    if (focusRequest === null || focusRequest.nonce === handledNonce.current) return;
    handledNonce.current = focusRequest.nonce;
    outbox.focus({ agentId: focusRequest.agentId });
  }, [focusRequest, outbox]);

  const gesture = useMemo(() => createStreamGesture(), []);
  const moveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (moveTimer.current !== null) clearTimeout(moveTimer.current);
    },
    [],
  );
  const touch = useCallback(
    (type: StreamTouch["type"], event: GestureResponderEvent) => {
      const { locationX, locationY } = event.nativeEvent;
      outbox.steps(gesture.touch({ type, x: locationX, y: locationY, at: Date.now() }));
      if (gesture.waiting() && moveTimer.current === null) {
        moveTimer.current = setTimeout(() => {
          moveTimer.current = null;
          outbox.steps(gesture.flush(Date.now()));
        }, MOVE_INTERVAL_MS);
      }
    },
    [gesture, outbox],
  );
  const responder = useMemo(
    () => ({
      onStartShouldSetResponder: () => true,
      onMoveShouldSetResponder: () => true,
      // Once a drag has started it stays here; a parent that asks for it is refused.
      onResponderTerminationRequest: () => false,
      onResponderGrant: (event: GestureResponderEvent) => touch("start", event),
      onResponderMove: (event: GestureResponderEvent) => touch("move", event),
      onResponderRelease: (event: GestureResponderEvent) => touch("end", event),
      onResponderTerminate: (event: GestureResponderEvent) => touch("cancel", event),
    }),
    [touch],
  );

  const source = useMemo(
    () => (state.picture === null ? null : { uri: state.picture.uri }),
    [state.picture],
  );
  return (
    <View
      style={styles.streamTouch}
      accessibilityRole="image"
      accessibilityLabel="Office in 3D"
      {...responder}
    >
      {source === null ? (
        <Text style={styles.sceneStatus}>Loading the 3D view...</Text>
      ) : (
        // The picture never takes the touch: positions are read against the view around it.
        <View style={styles.streamTouch} pointerEvents="none">
          <Image
            source={source}
            style={styles.streamPicture}
            resizeMode="contain"
            fadeDuration={0}
          />
        </View>
      )}
    </View>
  );
}
