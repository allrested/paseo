import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Pressable, Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import {
  useSettings,
  type PluginScreenProps,
  type PluginWorkspacePanelProps,
} from "@getpaseo/plugin/client";
import { officeDeviceSettings } from "../shared/settings.js";
import { ActionButton } from "./action-button.js";
import { AgentCard } from "./agent-card.js";
import { AttentionStrip } from "./attention-strip.js";
import {
  buildOfficeModel,
  orderRoomsForFocus,
  type OfficeModel,
  type OfficeRoom,
} from "./model.js";
import {
  NO_LAYOUT,
  SceneView,
  type FocusRequest,
  type SceneLayout,
  type SceneLayoutKeeper,
} from "./scene/scene-view.js";
import { hasWebGL2, listenForSpace } from "./scene/web-env.web.js";
import { StructureView } from "./structure-view.js";
import { useOfficeStyles, type OfficeStyles } from "./styles.js";
import { useAgentActions, type AgentActions } from "./use-agent-actions.js";
import { useOffice, type OfficeState } from "./use-office.js";

export type OfficeSurfaceProps = PluginScreenProps | PluginWorkspacePanelProps;

type Platform = OfficeSurfaceProps["layout"]["platform"];

/** What a browser says about its pointers. */
export interface PointerFacts {
  /** Any pointer of the device is coarse: `(any-pointer: coarse)`. */
  anyCoarse: boolean;
  touchPoints: number;
}

/**
 * The app's hasTouchScreen (packages/app/src/hooks/pointer-capabilities.ts), which a plugin cannot
 * import: native is always a touch screen, a browser answers for itself, and where there is no
 * browser to ask the answer is no.
 */
export function hasTouchScreen(platform: Platform, pointer: PointerFacts | null): boolean {
  if (platform !== "web") return true;
  return pointer !== null && (pointer.anyCoarse || pointer.touchPoints > 0);
}

// Web only: the surface asks when layout.platform is "web", and nothing asks at module top level.
function readPointer(): PointerFacts | null {
  if (typeof window === "undefined") return null;
  return {
    anyCoarse:
      typeof window.matchMedia === "function" && window.matchMedia("(any-pointer: coarse)").matches,
    touchPoints: window.navigator.maxTouchPoints,
  };
}

// A word with a sentence's capital ("Unexpected", "Failed"), not a name such as WebGL or Paseo.
const SENTENCE_START = /^(?!Paseo\b)[A-Z][a-z]+(?=\s|$)/;

/**
 * A failure and its reason as one sentence. The reason comes from outside (three.js, the
 * browser, the host), so it may start with a capital and end with a full stop.
 */
export function problemText(failure: string, reason: string): string {
  // A reason that is already a failure sentence is shown as it is, as failureText does.
  if (reason.trim().startsWith("Unable to")) return reason.trim();
  const text = reason.trim().replace(/[.\s]+$/, "");
  if (text === "") return failure;
  const first = SENTENCE_START.test(text) ? text.charAt(0).toLowerCase() : text.charAt(0);
  return `${failure}: ${first}${text.slice(1)}`;
}

/** The selection to keep: none once its agent has left the model or the data stopped being live. */
export function keptSelection(
  selectedId: string | null,
  agents: ReadonlyMap<string, unknown>,
  live: boolean,
): string | null {
  if (selectedId === null || !live || !agents.has(selectedId)) return null;
  return selectedId;
}

/** The device's 3D setting, as far as the surface reads it. */
export type ThreeDSetting =
  | { status: "loading" | "error" | "invalid" }
  | { status: "ready"; values: { threeD: boolean } };

/** The saved switch: not known while it is read, and on, the default, when it cannot be read. */
export function savedThreeD(setting: ThreeDSetting): boolean | null {
  if (setting.status === "loading") return null;
  return setting.status === "ready" ? setting.values.threeD : true;
}

/** The device's 3D setting as the switch's saves see it; null while it is read or unreadable. */
export interface StoredSwitch {
  /** Null when the stored document is not a valid setting: any tap overwrites it. */
  value: boolean | null;
  revision: string;
}

/** A save of the switch the surface started, and how far it got. */
export interface SwitchSave {
  value: boolean;
  /** The revision it was saved against. */
  against: string;
  /**
   * saving: not back yet. saved: stored, the store's new revision not yet read. failed: refused,
   * the store is read again. checked: refused, and the store was read again. given-up: refused for
   * good; `against` is then the revision the store held, and a change from elsewhere wins.
   */
  phase: "saving" | "saved" | "failed" | "checked" | "given-up";
}

/** The switch's taps against the device store: at most one save in flight. */
export interface SwitchSync {
  /** The last tap while it is not known to be stored; null shows the stored value. */
  wanted: boolean | null;
  save: SwitchSave | null;
  /** Saves retried after a conflict since the last tap. */
  retries: number;
}

export type SwitchEvent =
  | { type: "tap"; value: boolean }
  | { type: "start"; value: boolean; against: string; retry: boolean }
  | { type: "returned"; stored: boolean }
  | { type: "checked" }
  | { type: "give-up"; revision: string }
  | { type: "settle" };

/**
 * idle: no tap waits. wait: a save or a read is on its way. save: store the last tap. settle: the
 * store holds the last tap, or another writer changed it after a give-up, so stop holding it here.
 * give-up: the store refused it; the switch keeps showing the tap until the next tap, a change
 * from elsewhere or the surface closes.
 */
export type SwitchStep =
  | { kind: "idle" | "wait" | "settle" | "give-up" }
  | { kind: "save"; value: boolean; against: string; retry: boolean };

export const IDLE_SWITCH: SwitchSync = { wanted: null, save: null, retries: 0 };

/** One retry per conflict; a second conflict for the same tap gives up. */
const CONFLICT_RETRIES = 1;

export function switchSync(sync: SwitchSync, event: SwitchEvent): SwitchSync {
  switch (event.type) {
    case "tap": {
      // A save still on its way stays in flight; a refused one is forgotten, so the tap tries anew.
      const busy = sync.save?.phase === "saving" || sync.save?.phase === "saved";
      return { wanted: event.value, save: busy ? sync.save : null, retries: 0 };
    }
    case "start":
      return {
        ...sync,
        save: { value: event.value, against: event.against, phase: "saving" },
        retries: sync.retries + (event.retry ? 1 : 0),
      };
    case "returned":
      if (sync.save === null) return sync;
      return { ...sync, save: { ...sync.save, phase: event.stored ? "saved" : "failed" } };
    case "checked":
      if (sync.save?.phase !== "failed") return sync;
      return { ...sync, save: { ...sync.save, phase: "checked" } };
    case "give-up": {
      const { save } = sync;
      if (save === null) return sync;
      if (save.phase === "given-up" && save.against === event.revision) return sync;
      return { ...sync, save: { ...save, phase: "given-up", against: event.revision } };
    }
    case "settle":
      return IDLE_SWITCH;
  }
}

/**
 * What the switch does next, given the last tap, what the device holds and the save in flight.
 * Every save goes against the revision the store holds now, so taps are stored in their order.
 * A refused save is judged once the store was read again: a revision that moved is a conflict
 * and is retried once; one that did not move is a refusal for another reason, never retried.
 */
export function nextSwitchStep(sync: SwitchSync, stored: StoredSwitch | null): SwitchStep {
  if (sync.wanted === null) return { kind: "idle" };
  if (stored === null) return { kind: "wait" };
  const { save } = sync;
  let conflict = false;
  if (save !== null) {
    if (save.phase === "saving") return { kind: "wait" };
    // Given up: nothing is saved again, and a revision that moved was written elsewhere.
    if (save.phase === "given-up") {
      return stored.revision === save.against ? { kind: "give-up" } : { kind: "settle" };
    }
    if (stored.revision === save.against) {
      if (save.phase !== "checked") return { kind: "wait" };
      // Refused, but the store already holds the last tap: nothing is left to keep here.
      return stored.value === sync.wanted ? { kind: "settle" } : { kind: "give-up" };
    }
    conflict = save.phase !== "saved";
  }
  if (stored.value === sync.wanted) return { kind: "settle" };
  if (conflict && sync.retries >= CONFLICT_RETRIES) return { kind: "give-up" };
  return { kind: "save", value: sync.wanted, against: stored.revision, retry: conflict };
}

/** The camera's next request for a robot. Nonces start at 1: the scene counts 0 as handled. */
export function nextFocusRequest(previous: FocusRequest | null, agentId: string): FocusRequest {
  return { agentId, nonce: (previous?.nonce ?? 0) + 1 };
}

/** "fallback" is the structure view under the "Try 3D again" banner. */
export type OfficeView = "pending" | "scene" | "fallback" | "structure";

export interface OfficeViewInput {
  /** Web with WebGL2. */
  available: boolean;
  /** The 3D switch; null while the device's setting is being read. */
  threeD: boolean | null;
  /** Why 3D failed on this surface, if it did. */
  problem: string | null;
}

/** What the surface shows. It waits for the switch, so the list never flashes before the scene. */
export function officeView({ available, threeD, problem }: OfficeViewInput): OfficeView {
  if (!available || threeD === false) return "structure";
  if (threeD === null) return "pending";
  return problem === null ? "scene" : "fallback";
}

/** The model the scene draws: the live one, the same the list view shows; none without a scene. */
export function sceneModelFor(view: OfficeView, model: OfficeModel): OfficeModel | null {
  return view === "scene" ? model : null;
}

interface ThreeDState {
  /** Web with WebGL2: the switch is shown. */
  available: boolean;
  /** The switch's position; null while the device's setting is being read. */
  on: boolean | null;
  toggle(next: boolean): void;
}

/** The per-device 3D switch. Off, and everywhere 3D is unavailable, three.js is never loaded. */
function useThreeD(platform: Platform): ThreeDState {
  const settings = useSettings(officeDeviceSettings);
  const available = useMemo(() => platform === "web" && hasWebGL2(), [platform]);
  // The view follows the switch at once. A choice the device could not store stays here, so the
  // switch still does what it says until the surface closes.
  const [sync, dispatch] = useReducer(switchSync, IDLE_SWITCH);
  // A save or a read that comes back after the surface closed sets nothing and saves nothing.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const revision =
    settings.status === "ready" || settings.status === "invalid" ? settings.revision : null;
  const storedValue = settings.status === "ready" ? settings.values.threeD : null;
  const { save, reload } = settings;
  useEffect(() => {
    const stored = revision === null ? null : { value: storedValue, revision };
    const step = nextSwitchStep(sync, stored);
    if (step.kind === "settle") dispatch({ type: "settle" });
    if (step.kind === "give-up" && stored !== null) {
      dispatch({ type: "give-up", revision: stored.revision });
    }
    if (step.kind !== "save") return;
    dispatch({ type: "start", value: step.value, against: step.against, retry: step.retry });
    async function store(value: boolean, against: string): Promise<void> {
      const ok = await save({ threeD: value }, against);
      if (!mounted.current) return;
      dispatch({ type: "returned", stored: ok });
      if (ok) return;
      // Read the store again: its revision tells a conflict from a refusal.
      await reload().catch(() => undefined);
      if (mounted.current) dispatch({ type: "checked" });
    }
    void store(step.value, step.against);
  }, [sync, revision, storedValue, save, reload]);
  const toggle = useCallback((next: boolean) => dispatch({ type: "tap", value: next }), []);
  return { available, on: available ? (sync.wanted ?? savedThreeD(settings)) : false, toggle };
}

interface ThreeDSwitchProps {
  /** Null while the device's setting is being read: drawn on, the default, and not yet usable. */
  value: boolean | null;
  onChange(next: boolean): void;
  styles: OfficeStyles;
}

/**
 * Drawn here, with the role, state and sizes of the app's switch
 * (packages/app/src/components/ui/switch.tsx). A plugin can render that switch through
 * SettingsSwitch (@getpaseo/plugin/client/ui), and it follows the theme with a 44 x 44 target,
 * but only as a settings row: 16 px of padding on every side, the label outside the target and,
 * on a phone, stacked over the switch. In this header at 390 px wide that row measured 104 px
 * tall. Here the label is inside the target, so the row is 44 px tall on a touch screen, says
 * what it turns, and has room for more controls beside it. react-native's Switch is 40 x 20 on
 * web whatever the pointer, and its thumb is a fixed teal while on.
 */
function ThreeDSwitch({ value, onChange, styles }: ThreeDSwitchProps) {
  const on = value ?? true;
  const disabled = value === null;
  const flip = useCallback(() => onChange(!on), [onChange, on]);
  // Enter presses any Pressable; Space, the key that turns a switch, only a button.
  const id = useId();
  useEffect(() => (disabled ? undefined : listenForSpace(id, flip)), [id, flip, disabled]);
  return (
    <Pressable
      id={id}
      accessibilityRole="switch"
      accessibilityLabel="3D view"
      aria-checked={on}
      disabled={disabled}
      onPress={flip}
      style={disabled ? styles.controlDisabled : styles.control}
    >
      <Text style={styles.controlLabel}>3D view</Text>
      <View style={on ? styles.switchOn : styles.switchOff}>
        <View style={on ? styles.switchOnThumb : styles.switchOffThumb} />
      </View>
    </Pressable>
  );
}

interface SceneProblemProps {
  message: string;
  onRetry(): void;
  styles: OfficeStyles;
}

interface ProblemBannerProps {
  text: string;
  styles: OfficeStyles;
  children?: ReactNode;
}

/** A failure in the app's bordered banner, with room for a way out under the sentence. */
function ProblemBanner({ text, styles, children }: ProblemBannerProps) {
  return (
    <View style={styles.bannerSlot}>
      <View style={styles.banner}>
        <Text accessibilityRole="alert" style={styles.bannerText}>
          {text}
        </Text>
        {children}
      </View>
    </View>
  );
}

function SceneProblem({ message, onRetry, styles }: SceneProblemProps) {
  return (
    <ProblemBanner text={problemText("Unable to show the 3D view", message)} styles={styles}>
      <View style={styles.actions}>
        <ActionButton
          label="Try 3D again"
          pendingLabel="Trying..."
          onPress={onRetry}
          styles={styles}
        />
      </View>
    </ProblemBanner>
  );
}

interface SurfaceBodyProps {
  office: OfficeState;
  rooms: readonly OfficeRoom[];
  /** The model the scene draws; null shows the structure view. */
  sceneModel: OfficeModel | null;
  /** The 3D switch is still being read: neither view yet. */
  waiting: boolean;
  theme: PluginTheme;
  focusRoomId: string | null;
  focusRequest: FocusRequest | null;
  layoutKeeper: SceneLayoutKeeper;
  styles: OfficeStyles;
  actions: AgentActions;
  onSelectAgent(agentId: string): void;
  onOpenSession: ((agentId: string) => void) | undefined;
  onSceneProblem(message: string): void;
}

function SurfaceBody({
  office,
  rooms,
  sceneModel,
  waiting,
  theme,
  focusRoomId,
  focusRequest,
  layoutKeeper,
  styles,
  actions,
  onSelectAgent,
  onOpenSession,
  onSceneProblem,
}: SurfaceBodyProps) {
  if (office.subscription.status === "error") {
    const { message } = office.subscription.error;
    return (
      <ProblemBanner text={problemText("Unable to load the office", message)} styles={styles} />
    );
  }
  // Closed means the plugin's handler finished, and the hook does not subscribe again: without
  // this the rows would stay on screen and never change.
  if (office.subscription.status === "closed") {
    return (
      <ProblemBanner
        text="Unable to show live agents: the host closed the office. Reopen it."
        styles={styles}
      />
    );
  }
  if (!office.loaded || waiting) return <Text style={styles.sceneStatus}>Loading...</Text>;
  if (sceneModel !== null) {
    return (
      <SceneView
        model={sceneModel}
        theme={theme}
        styles={styles}
        focusRoomId={focusRoomId}
        focusRequest={focusRequest}
        layoutKeeper={layoutKeeper}
        onSelectAgent={onSelectAgent}
        onProblem={onSceneProblem}
      />
    );
  }
  return (
    <StructureView
      rooms={rooms}
      styles={styles}
      actions={actions}
      onSelectAgent={onSelectAgent}
      onOpenSession={onOpenSession}
    />
  );
}

/** One surface for both places: the sidebar screen and a workspace tab. */
export function OfficeSurface(props: OfficeSurfaceProps) {
  const { theme, layout, navigation } = props;
  const focusRoomId = "workspaceId" in props ? props.workspaceId : null;
  // Asked once for the surface's life, like the app: a mouse plugged into a tablet does not
  // shrink its controls.
  const touchScreen = useMemo(
    () => hasTouchScreen(layout.platform, layout.platform === "web" ? readPointer() : null),
    [layout.platform],
  );
  const styles = useOfficeStyles(theme, layout.compact, touchScreen);
  const office = useOffice();
  const actions = useAgentActions();
  const threeD = useThreeD(layout.platform);
  const model = useMemo(() => buildOfficeModel(office.state), [office.state]);
  const rooms = useMemo(
    () => orderRoomsForFocus(model.rooms, focusRoomId),
    [model.rooms, focusRoomId],
  );
  // In error or closed the data is frozen: no strip and no card to act on it.
  const live = office.subscription.status !== "error" && office.subscription.status !== "closed";
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sceneProblem, setSceneProblem] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const closeCard = useCallback(() => setSelectedId(null), []);
  // The strip is the phone's fast path: it opens the card and moves the camera to the robot.
  const selectFromStrip = useCallback((agentId: string) => {
    setSelectedId(agentId);
    setFocusRequest((previous) => nextFocusRequest(previous, agentId));
  }, []);
  // The rooms' places outlive the scene: 3D off and on, "Try 3D again" and an error keep them.
  const sceneLayout = useRef<SceneLayout>(NO_LAYOUT);
  const openSession = useCallback(
    (agentId: string) => navigation?.openAgent({ agentId }),
    [navigation],
  );
  const retryScene = useCallback(() => setSceneProblem(null), []);
  // Turning the switch asks for 3D anew, so an old failure does not stand in its way.
  const { toggle } = threeD;
  const changeThreeD = useCallback(
    (next: boolean) => {
      setSceneProblem(null);
      toggle(next);
    },
    [toggle],
  );
  const view = officeView({
    available: threeD.available,
    threeD: threeD.on,
    problem: sceneProblem,
  });
  const kept = keptSelection(selectedId, model.agents, live);
  // A selection whose agent left is dropped, so the card does not reopen if that agent returns.
  useEffect(() => {
    if (kept !== selectedId) setSelectedId(kept);
  }, [kept, selectedId]);
  const selected = kept === null ? null : (model.agents.get(kept) ?? null);
  const selectedActivity = kept === null ? null : (office.state.activity[kept] ?? null);
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        {threeD.available ? (
          <View style={styles.headerRow}>
            <ThreeDSwitch value={threeD.on} onChange={changeThreeD} styles={styles} />
          </View>
        ) : null}
        {live ? (
          <AttentionStrip entries={model.attention} styles={styles} onSelect={selectFromStrip} />
        ) : null}
      </View>
      {view === "fallback" && sceneProblem !== null ? (
        <SceneProblem message={sceneProblem} onRetry={retryScene} styles={styles} />
      ) : null}
      <SurfaceBody
        office={office}
        rooms={rooms}
        sceneModel={sceneModelFor(view, model)}
        waiting={view === "pending"}
        theme={theme}
        focusRoomId={focusRoomId}
        focusRequest={focusRequest}
        layoutKeeper={sceneLayout}
        styles={styles}
        actions={actions}
        onSelectAgent={setSelectedId}
        onOpenSession={navigation ? openSession : undefined}
        onSceneProblem={setSceneProblem}
      />
      <AgentCard
        agent={selected}
        activity={selectedActivity}
        actions={actions}
        navigation={navigation}
        styles={styles}
        onClose={closeCard}
      />
    </View>
  );
}
