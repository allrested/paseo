// The Android device in a panel: its screen as pictures sent by the host, and touches, keys and
// text sent back. Everything here is a React Native primitive: the store app evaluates this
// bundle as it is.
import { useCallback, useEffect, useId, useMemo, useReducer, useRef, useState } from "react";
import {
  AppState,
  Image,
  Pressable,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type PressableStateCallbackType,
} from "react-native";
import {
  useRpc,
  useSettings,
  useSubscription,
  type PluginScreenProps,
  type SettingsState,
  type PluginWorkspacePanelProps,
} from "@getpaseo/plugin/client";
import { TextInput } from "@getpaseo/plugin/client/ui";
import {
  androidInputRpc,
  androidStateRpc,
  androidStreamSubscription,
  type AndroidKey,
  type AndroidStreamEvent,
} from "../shared/contracts.js";
import { androidHostSettings } from "../shared/settings.js";
import { createStreamGesture, gestureToDevice, type Size } from "./stream-gesture.js";
import { createStreamOutbox } from "./stream-outbox.js";
import { INITIAL_STREAM, streamReducer } from "./stream-state.js";
import { useAndroidStyles, type AndroidStyles } from "./styles.js";

export type AndroidSurfaceProps = PluginScreenProps | PluginWorkspacePanelProps;

/** The host closes a stream that hears nothing for 30 seconds. */
export const KEEP_ALIVE_MS = 10_000;
export const NO_DEVICE = "No Android device on this host";
const HOST_CLOSED = "The Android view was closed by the host";

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

/**
 * What the state call tells the panel. A host with no device does not serve the call at all, and
 * the host's answer to a call it does not serve names it: that, like `available: false`, is "no
 * device"; any other failure is a failure.
 */
export function stateOutcome(
  answer: { ok: true; available: boolean } | { ok: false; error: unknown },
): { kind: "device" } | { kind: "none" } | { kind: "failed"; message: string } {
  if (answer.ok) return answer.available ? { kind: "device" } : { kind: "none" };
  const message = answer.error instanceof Error ? answer.error.message : String(answer.error);
  return message.startsWith("Unknown RPC method") ? { kind: "none" } : { kind: "failed", message };
}

interface ButtonProps {
  label: string;
  onPress(): void;
  styles: AndroidStyles;
  slot?: boolean;
}

function Button({ label, onPress, styles, slot = false }: ButtonProps) {
  const style = useCallback(
    ({ pressed }: PressableStateCallbackType) => (pressed ? styles.buttonPressed : styles.button),
    [styles],
  );
  return (
    <View style={slot ? styles.keyButton : undefined}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        style={style}
      >
        <View style={styles.buttonFill} />
        <Text style={styles.buttonText} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
    </View>
  );
}

interface KeyButtonProps {
  label: string;
  name: AndroidKey;
  onKey(name: AndroidKey): void;
  styles: AndroidStyles;
}

function KeyButton({ label, name, onKey, styles }: KeyButtonProps) {
  const press = useCallback(() => onKey(name), [onKey, name]);
  return <Button label={label} onPress={press} styles={styles} slot />;
}

interface ProblemBannerProps {
  text: string;
  onRetry(): void;
  styles: AndroidStyles;
}

/** A failure in the app's bordered banner, with its way out under the sentence. */
function ProblemBanner({ text, onRetry, styles }: ProblemBannerProps) {
  return (
    <View style={styles.bannerSlot}>
      <View style={styles.banner}>
        <Text accessibilityRole="alert" style={styles.bannerText}>
          {text}
        </Text>
        <View style={styles.actions}>
          <Button label="Retry" onPress={onRetry} styles={styles} />
        </View>
      </View>
    </View>
  );
}

interface AgentToolsSwitchProps {
  styles: AndroidStyles;
}

type HostSettings = SettingsState<typeof androidHostSettings.schema>;

/** "Agent tools" as the host holds it: a setting that is not valid counts as on, as the host reads it. */
function storedTools(settings: HostSettings): boolean | null {
  if (settings.status === "ready") return settings.values.agentTools;
  return settings.status === "invalid" ? true : null;
}

/** The host setting: Android tools in agent sessions opened from now on. */
function AgentToolsSwitch({ styles }: AgentToolsSwitchProps) {
  const settings = useSettings(androidHostSettings);
  const stored = storedTools(settings);
  const revision =
    settings.status === "ready" || settings.status === "invalid" ? settings.revision : null;
  // The tap, until the host has answered it.
  const [wanted, setWanted] = useState<boolean | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const { save, saveError } = settings;
  const toggle = useCallback(
    (next: boolean) => {
      if (revision === null) return;
      setWanted(next);
      // Never rejects: a refused save leaves its reason in saveError.
      void save({ agentTools: next }, revision).finally(() => {
        if (mounted.current) setWanted(null);
      });
    },
    [save, revision],
  );
  const value = wanted ?? stored;
  const on = value ?? true;
  const disabled = value === null;
  const flip = useCallback(() => toggle(!on), [toggle, on]);
  const id = useId();
  return (
    <View style={styles.header}>
      <Pressable
        id={id}
        accessibilityRole="switch"
        accessibilityLabel="Agent tools"
        aria-checked={on}
        disabled={disabled}
        onPress={flip}
        style={disabled ? styles.controlDisabled : styles.control}
      >
        <Text style={styles.controlLabel}>Agent tools</Text>
        <View style={on ? styles.switchOn : styles.switchOff}>
          <View style={on ? styles.switchOnThumb : styles.switchOffThumb} />
        </View>
      </Pressable>
      {saveError === null ? null : (
        <Text accessibilityRole="alert" style={styles.refused}>
          Unable to save the Agent tools setting
        </Text>
      )}
    </View>
  );
}

interface DeviceViewProps {
  styles: AndroidStyles;
}

/** The stream and its controls for as long as the view has a size and the app is in front. */
function DeviceView({ styles }: DeviceViewProps) {
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
  // Retry opens the stream again: a new key is a new subscription.
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  return (
    <View style={styles.screen}>
      <AgentToolsSwitch styles={styles} />
      <View style={styles.stage} onLayout={onLayout}>
        {streamShown(size, appState) ? (
          <Stream key={attempt} styles={styles} onRetry={retry} />
        ) : (
          <Text style={styles.status}>Connecting to the Android device...</Text>
        )}
      </View>
    </View>
  );
}

interface StreamProps {
  styles: AndroidStyles;
  onRetry(): void;
}

function Stream({ styles, onRetry }: StreamProps) {
  const [state, dispatch] = useReducer(streamReducer, INITIAL_STREAM);
  const [lost, setLost] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const send = useRpc(androidInputRpc);
  const outbox = useMemo(
    () =>
      createStreamOutbox({
        send,
        onLost: setLost,
        onRefused: setRefused,
        onAccepted: () => setRefused(null),
      }),
    [send],
  );
  useEffect(() => () => outbox.stop(), [outbox]);

  const onEvent = useCallback(
    (event: AndroidStreamEvent) => {
      dispatch(event);
      if (event.type === "ready") {
        // A new stream starts over: what went wrong on the one before is not this one's.
        setLost(null);
        setRefused(null);
        outbox.ready(event.streamId);
      } else if (event.type === "picture") outbox.shown(event.seq);
    },
    [outbox],
  );
  const subscription = useSubscription(androidStreamSubscription, EMPTY_INPUT, onEvent);
  const { status } = subscription;
  const failure = subscription.status === "error" ? subscription.error.message : null;
  const { problem } = state;
  // The host says why before it closes a stream; a close with no reason is a problem too.
  const shownProblem = problem ?? failure ?? lost ?? (status === "closed" ? HOST_CLOSED : null);

  useEffect(() => {
    const timer = setInterval(() => outbox.keepAlive(), KEEP_ALIVE_MS);
    return () => clearInterval(timer);
  }, [outbox]);

  // Touches are read against the view that takes them, not the stage around the keys and the text row.
  const [area, setArea] = useState<Size | null>(null);
  const onAreaLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setArea((previous) => sizeAfterLayout(previous, width, height));
  }, []);
  const gesture = useMemo(() => createStreamGesture(), []);
  const { device } = state;
  const touch = useCallback(
    (type: "start" | "move" | "end" | "cancel", event: GestureResponderEvent) => {
      const { locationX, locationY } = event.nativeEvent;
      const action = gesture.touch({ type, x: locationX, y: locationY, at: Date.now() });
      if (action === null || device === null || area === null) return;
      const input = gestureToDevice(action, area, device);
      if (input !== null) outbox.input(input);
    },
    [gesture, outbox, area, device],
  );
  const responder = useMemo(
    () => ({
      onStartShouldSetResponder: () => true,
      onMoveShouldSetResponder: () => true,
      // Once a swipe has started it stays here; a parent that asks for it is refused.
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

  const press = useCallback((key: AndroidKey) => outbox.input({ key }), [outbox]);
  const [text, setText] = useState("");
  const sendText = useCallback(() => {
    if (text === "") return;
    outbox.input({ text });
    setText("");
  }, [outbox, text]);

  return (
    <View style={styles.touch}>
      {shownProblem === null ? null : (
        <ProblemBanner text={shownProblem} onRetry={onRetry} styles={styles} />
      )}
      <View
        style={styles.touch}
        accessibilityRole="image"
        accessibilityLabel="Android device"
        onLayout={onAreaLayout}
        {...responder}
      >
        {source === null ? (
          <Text style={styles.status}>Connecting to the Android device...</Text>
        ) : (
          // The picture never takes the touch: positions are read against the view around it.
          <View style={styles.touch} pointerEvents="none">
            <Image source={source} style={styles.picture} resizeMode="contain" fadeDuration={0} />
          </View>
        )}
      </View>
      <View style={styles.keys}>
        <KeyButton label="Back" name="back" onKey={press} styles={styles} />
        <KeyButton label="Home" name="home" onKey={press} styles={styles} />
        <KeyButton label="Recents" name="recents" onKey={press} styles={styles} />
      </View>
      <View style={styles.textRow}>
        <View style={styles.inputSlot}>
          <TextInput
            accessibilityLabel="Text to type on the device"
            value={text}
            onChangeText={setText}
            onSubmitEditing={sendText}
            placeholder="Type on the device"
            placeholderTextColor={styles.placeholderColor}
            maxLength={500}
            style={styles.input}
          />
        </View>
        <Button label="Send" onPress={sendText} styles={styles} />
      </View>
      {refused === null ? null : (
        <Text accessibilityRole="alert" style={styles.refused}>
          {refused}
        </Text>
      )}
    </View>
  );
}

const EMPTY_INPUT = {};

/** One surface for both places: the sidebar screen and a workspace tab. */
export function AndroidSurface({ theme, layout }: AndroidSurfaceProps) {
  const styles = useAndroidStyles(theme, layout.compact);
  const askState = useRpc(androidStateRpc);
  type Outcome = ReturnType<typeof stateOutcome> | { kind: "loading" };
  const [outcome, setOutcome] = useState<Outcome>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setOutcome({ kind: "loading" });
    askState({}).then(
      (state) => active && setOutcome(stateOutcome({ ok: true, available: state.available })),
      (error: unknown) => active && setOutcome(stateOutcome({ ok: false, error })),
    );
    return () => {
      active = false;
    };
  }, [askState, attempt]);
  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  if (outcome.kind === "device") return <DeviceView styles={styles} />;
  return (
    <View style={styles.screen}>
      {outcome.kind === "loading" ? <Text style={styles.status}>Loading...</Text> : null}
      {outcome.kind === "none" ? <Text style={styles.status}>{NO_DEVICE}</Text> : null}
      {outcome.kind === "failed" ? (
        <ProblemBanner
          text={`Unable to read the Android device: ${outcome.message}`}
          onRetry={retry}
          styles={styles}
        />
      ) : null}
    </View>
  );
}
