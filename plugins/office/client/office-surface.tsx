import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Pressable, Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import {
  useRpc,
  useSettings,
  type PluginScreenProps,
  type PluginWorkspacePanelProps,
} from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { notesReadRpc, type IncidentsState, type Machine } from "../shared/contracts.js";
import {
  OFFICE_VIEWS,
  officeDeviceSettings,
  officeHostSettings,
  type OfficeViewChoice,
} from "../shared/settings.js";
import { ActionButton } from "./action-button.js";
import { AgentCard } from "./agent-card.js";
import { sheetLeavesFirstOn } from "./agent-picker-text.js";
import { AttentionStrip, type StripCard } from "./attention-strip.js";
import { openSessionWith, resourcesOpener } from "./beside.js";
import { BoardSheet } from "./board-sheet.js";
import { authorName } from "./board-text.js";
import { useChatSeen } from "./chat-seen.js";
import { unreadCount, unreadLabel } from "./chat-text.js";
import { HostSwitches } from "./host-switches.js";
import { IncidentsCard } from "./incidents-card.js";
import { incidentsEntry } from "./incidents-text.js";
import { janitorNote, janitorRows } from "./context-text.js";
import { JanitorCard } from "./janitor-card.js";
import { MachineCard } from "./machine-card.js";
import { hostNote, namedMachine, type HostNote } from "../shared/machine-text.js";
import {
  ACTIVITY_SCREEN,
  CHAT_SCREEN,
  SESSIONS_SCREEN,
  claimOfficeLink,
  useOfficeLink,
  type OfficeLink,
} from "./office-link.js";
import {
  buildOfficeModel,
  orderRoomsForFocus,
  type OfficeModel,
  type OfficeRoom,
} from "../shared/model.js";
import type { FocusRequest } from "./focus-request.js";
import { PixelOffice } from "./pixel/pixel-office.js";
import { StructureView } from "./structure-view.js";
import { useOfficeStyles, type OfficeStyles } from "./styles.js";
import { useAgentActions, type AgentActions } from "./use-agent-actions.js";
import { useBoardActions } from "./use-board-actions.js";
import { LibraryCard } from "./library-card.js";
import { NotesCard } from "./notes-card.js";
import { todayZone } from "./notes-text.js";
import { QaCard } from "./qa-card.js";
import { ReviewCard } from "./review-card.js";
import { StandupCard } from "./standup-card.js";
import { useIncidents } from "./use-incidents.js";
import { useJanitor } from "./use-janitor.js";
import { useLibrary } from "./use-library.js";
import { useQa } from "./use-qa.js";
import { useReviews } from "./use-reviews.js";
import { useScriptLog } from "./use-script-log.js";
import { useStandup } from "./use-standup.js";
import { useMachine } from "./use-machine.js";
import { useOffice, type OfficeState } from "./use-office.js";
import { ViewSwitch } from "./view-switch.js";
import { hasWebGL2 } from "./web-env.web.js";
import { hasScriptFrame } from "./world/script-frame-kit.js";
import { WorldView } from "./world/world-view.js";
import { WorldViewNative } from "./world/world-view-native.js";

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
export function readPointer(): PointerFacts | null {
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

/** The device's view setting, as far as the surface reads it. */
export type ViewSetting =
  | { status: "loading" | "error" | "invalid" }
  | { status: "ready"; values: { threeD: boolean; view?: OfficeViewChoice | undefined } };

/** What a device holds: the view somebody chose there, or "auto" where nobody did. */
export type SavedView = OfficeViewChoice | "auto";

/**
 * The view somebody chose in a stored setting; null where nobody did. A setting from before
 * there were three views has the 3D switch alone: off was the list, on chose nothing.
 */
export function chosenView(values: {
  threeD: boolean;
  view?: OfficeViewChoice | undefined;
}): OfficeViewChoice | null {
  return values.view ?? (values.threeD ? null : "list");
}

/** The saved view: not known while it is read, and "auto" when it cannot be read. */
export function savedView(setting: ViewSetting): SavedView | null {
  if (setting.status === "loading") return null;
  if (setting.status !== "ready") return "auto";
  return chosenView(setting.values) ?? "auto";
}

/**
 * The view a saved choice means on this device. Only a device that can draw the 3D office shows
 * it; anywhere else that choice, and no choice, is the 2D one.
 */
export function viewOnDevice(saved: SavedView, can3d: boolean): OfficeViewChoice {
  if (saved === "2d" || saved === "list") return saved;
  return can3d ? "3d" : "2d";
}

/** The views a device offers, in the switch's order. */
export function viewOptions(can3d: boolean): readonly OfficeViewChoice[] {
  return can3d ? OFFICE_VIEWS : OFFICE_VIEWS.filter((view) => view !== "3d");
}

/**
 * Whether this device can draw the 3D office: a browser with WebGL2, or an app whose kit has
 * ScriptFrame. The other is not asked. On an app the page finds out whether the phone has WebGL2
 * (the scene reports a problem if not), and the surface gives way to 2D.
 */
export function canDraw3D(
  platform: Platform,
  webgl2: () => boolean,
  scriptFrame: () => boolean,
): boolean {
  return platform === "web" ? webgl2() : scriptFrame();
}

/** The view that draws the 3D office: its frame in a browser, ScriptFrame in an app. */
export function worldViewFor(platform: Platform): typeof WorldView | typeof WorldViewNative {
  return platform === "web" ? WorldView : WorldViewNative;
}

/** A device setting as a switch's saves see it; null while it is read or unreadable. */
export interface StoredSwitch<Value> {
  /** Null when the store holds no choice or no valid setting: any tap overwrites it. */
  value: Value | null;
  revision: string;
}

/** A save of the switch the surface started, and how far it got. */
export interface SwitchSave<Value> {
  value: Value;
  /** The revision it was saved against. */
  against: string;
  /**
   * saving: not back yet. saved: stored, the store's new revision not yet read. failed: refused,
   * the store is read again. checked: refused, and the store was read again. given-up: refused for
   * good; `against` is then the revision the store held, and a change from elsewhere wins.
   */
  phase: "saving" | "saved" | "failed" | "checked" | "given-up";
}

/** A switch's taps against the device store: at most one save in flight. */
export interface SwitchSync<Value> {
  /** The last tap while it is not known to be stored; null shows the stored value. */
  wanted: Value | null;
  save: SwitchSave<Value> | null;
  /** Saves retried after a conflict since the last tap. */
  retries: number;
}

export type SwitchEvent<Value> =
  | { type: "tap"; value: Value }
  | { type: "start"; value: Value; against: string; retry: boolean }
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
export type SwitchStep<Value> =
  | { kind: "idle" | "wait" | "settle" | "give-up" }
  | { kind: "save"; value: Value; against: string; retry: boolean };

export const IDLE_SWITCH: SwitchSync<never> = { wanted: null, save: null, retries: 0 };

/** One retry per conflict; a second conflict for the same tap gives up. */
const CONFLICT_RETRIES = 1;

export function switchSync<Value>(
  sync: SwitchSync<Value>,
  event: SwitchEvent<Value>,
): SwitchSync<Value> {
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
export function nextSwitchStep<Value>(
  sync: SwitchSync<Value>,
  stored: StoredSwitch<Value> | null,
): SwitchStep<Value> {
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

/**
 * The switch shows a tap the device refused to store: the view follows it until the surface
 * closes, and after a reload the stored value is back.
 */
export function switchUnsaved(sync: SwitchSync<unknown>): boolean {
  return sync.save?.phase === "given-up";
}

const UNSAVED_VIEW = "Unable to save the view on this device. It holds until the office is closed.";

/** The view's next request for an agent. Nonces start at 1: the scene counts 0 as handled. */
export function nextFocusRequest(previous: FocusRequest | null, agentId: string): FocusRequest {
  return { agentId, nonce: (previous?.nonce ?? 0) + 1 };
}

/** What the surface shows; "pending" while the device's choice is being read. */
export type OfficeView = "pending" | OfficeViewChoice;

export interface OfficeViewInput {
  /** The view chosen on this device; null while the device's setting is being read. */
  choice: OfficeViewChoice | null;
  /** Why 3D failed on this surface, if it did. */
  problem: string | null;
}

/**
 * What the surface shows. It waits for the choice, so no other view flashes before the chosen
 * one. A 3D office that failed gives way to the 2D one, under a banner with a way to try again.
 */
export function officeView({ choice, problem }: OfficeViewInput): OfficeView {
  if (choice === null) return "pending";
  return choice === "3d" && problem !== null ? "2d" : choice;
}

interface ViewChoiceState {
  /** The views this device offers. */
  options: readonly OfficeViewChoice[];
  /** The chosen view; null while the device's setting is being read. */
  choice: OfficeViewChoice | null;
  /** The device refused to store the last tap. */
  unsaved: boolean;
  choose(next: OfficeViewChoice): void;
}

function viewSync(
  sync: SwitchSync<OfficeViewChoice>,
  event: SwitchEvent<OfficeViewChoice>,
): SwitchSync<OfficeViewChoice> {
  return switchSync(sync, event);
}

const NONE_RUNG: Record<string, number> = {};

/** The per-device view. The 3D office is loaded only where it is the chosen view. */
function useViewChoice(platform: Platform): ViewChoiceState {
  const settings = useSettings(officeDeviceSettings);
  const can3d = useMemo(() => canDraw3D(platform, hasWebGL2, hasScriptFrame), [platform]);
  // The view follows the tap at once. A choice the device could not store stays here, so the
  // switch still does what it says until the surface closes.
  const [sync, dispatch] = useReducer(viewSync, IDLE_SWITCH);
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
  const storedValue = settings.status === "ready" ? chosenView(settings.values) : null;
  // A view's save keeps the incidents this device rang for.
  const rungIncidents = settings.status === "ready" ? settings.values.rungIncidents : NONE_RUNG;
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
    async function store(value: OfficeViewChoice, against: string): Promise<void> {
      const ok = await save({ threeD: value !== "list", view: value, rungIncidents }, against);
      if (!mounted.current) return;
      dispatch({ type: "returned", stored: ok });
      if (ok) return;
      // Read the store again: its revision tells a conflict from a refusal.
      await reload().catch(() => undefined);
      if (mounted.current) dispatch({ type: "checked" });
    }
    void store(step.value, step.against);
  }, [sync, revision, storedValue, rungIncidents, save, reload]);
  const choose = useCallback(
    (next: OfficeViewChoice) => dispatch({ type: "tap", value: next }),
    [],
  );
  const options = useMemo(() => viewOptions(can3d), [can3d]);
  const saved = sync.wanted ?? savedView(settings);
  return {
    options,
    choice: saved === null ? null : viewOnDevice(saved, can3d),
    unsaved: switchUnsaved(sync),
    choose,
  };
}

/** The zone the stand-up notes' "today" is judged in, from the host's notes time zone. */
function useNotesTimeZone(): string {
  const settings = useSettings(officeHostSettings);
  const setting = settings.status === "ready" ? settings.values.notesTimeZone : "";
  return useMemo(() => todayZone(setting), [setting]);
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

interface PanelButtonProps {
  /** What it opens, and what a screen reader calls it. */
  label: string;
  /** A Lucide name. */
  icon: string;
  screenId: string;
  size: number;
  /** The theme's foreground: an icon-only control's glyph, not a label's muted one. */
  color: string;
  /** What is new behind it, shown over the icon; null when nothing is. */
  count?: string | null;
  onOpen(screenId: string): void;
  styles: OfficeStyles;
}

/**
 * A panel's button in the header: a segment's pill with the kit's icon in it. It shows a screen
 * beside the floor, so it has no chosen state: the side area's header says what is shown.
 */
function PanelButton({
  label,
  icon,
  screenId,
  size,
  color,
  count,
  onOpen,
  styles,
}: PanelButtonProps) {
  const press = useCallback(() => onOpen(screenId), [onOpen, screenId]);
  const [hovered, setHovered] = useState(false);
  const hoverIn = useCallback(() => setHovered(true), []);
  const hoverOut = useCallback(() => setHovered(false), []);
  const [pressed, setPressed] = useState(false);
  const pressIn = useCallback(() => setPressed(true), []);
  const pressOut = useCallback(() => setPressed(false), []);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={count ? `${label}, ${count} new` : label}
      onPress={press}
      onPressIn={pressIn}
      onPressOut={pressOut}
      onHoverIn={hoverIn}
      onHoverOut={hoverOut}
      style={styles.segment}
    >
      {hovered || pressed ? <View style={styles.segmentHoverFill} /> : null}
      {/* The count sits on the icon's corner, inside the pill that clips. */}
      <View>
        <Icon name={icon} size={size} color={color} />
        {count ? (
          <View style={styles.chatBadge}>
            <Text style={styles.chatBadgeText}>{count}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

interface PanelButtonsProps {
  /** Null, or with no `showBeside`, on an app without a side area: the panels are not offered. */
  navigation: PluginScreenProps["navigation"];
  /** This surface's link, which it claims as it opens a panel. */
  link: OfficeLink;
  /** The app's two control sizes: touch-sized in the compact layout or on a touch screen. */
  compact: boolean;
  touchScreen: boolean;
  /** The theme's foreground, which an icon-only control's glyph rests at. */
  color: string;
  /** The chat's messages since it was last open on this device; null at none. */
  unread: string | null;
  styles: OfficeStyles;
}

/** The Chat button's count: the chat's messages since it was last open on this device. */
function useUnread(chat: OfficeState["chat"]): string | null {
  const seenAt = useChatSeen();
  return unreadLabel(unreadCount(chat?.messages ?? [], seenAt));
}

/** The header's ways to the panels, after the view switch. */
function PanelButtons({
  navigation,
  link,
  compact,
  touchScreen,
  color,
  unread,
  styles,
}: PanelButtonsProps) {
  const showBeside = navigation?.showBeside;
  const open = useCallback(
    (screenId: string) => {
      claimOfficeLink(link);
      showBeside?.({ kind: "screen", pluginId: "office", screenId });
    },
    [link, showBeside],
  );
  if (showBeside === undefined) return null;
  // The glyph at the app's icon sizes (control-geometry.ts iconSizeFor("md")).
  const size = compact || touchScreen ? 20 : 16;
  return (
    <>
      <PanelButton
        label="Sessions"
        icon="Users"
        screenId={SESSIONS_SCREEN}
        size={size}
        color={color}
        onOpen={open}
        styles={styles}
      />
      <PanelButton
        label="Activity"
        icon="Activity"
        screenId={ACTIVITY_SCREEN}
        size={size}
        color={color}
        onOpen={open}
        styles={styles}
      />
      <PanelButton
        label="Chat"
        icon="MessageCircle"
        screenId={CHAT_SCREEN}
        size={size}
        color={color}
        count={unread}
        onOpen={open}
        styles={styles}
      />
    </>
  );
}

interface SurfaceBodyProps {
  office: OfficeState;
  model: OfficeModel;
  rooms: readonly OfficeRoom[];
  view: OfficeView;
  theme: PluginTheme;
  focusRoomId: string | null;
  focusRequest: FocusRequest | null;
  /** Whose card is open. */
  selectedAgentId: string | null;
  styles: OfficeStyles;
  compact: boolean;
  actions: AgentActions;
  name(author: string): string;
  /** Null from the 3D office, when the chosen person is tapped again. */
  onSelectAgent(agentId: string | null): void;
  onOpenSession: ((agentId: string) => void) | undefined;
  onOpenBoard(roomId: string): void;
  machine: Machine | null;
  onOpenMachine(): void;
  /** The 3D wall screen's: absent on an app that cannot show Resources beside the floor. */
  onOpenResources: (() => void) | undefined;
  onOpenLibrary(): void;
  /** The 3D office's label over the meeting room's screen. */
  onOpenNotes(): void;
  janitor: HostNote | null;
  onOpenJanitor(): void;
  /** The stand-up is open. */
  meeting: boolean;
  incidents: IncidentsState | undefined;
  /** The 3D office's incidents banner. */
  onOpenIncidents(): void;
  onSceneProblem(message: string): void;
  platform: Platform;
}

function SurfaceBody({
  office,
  model,
  rooms,
  view,
  theme,
  focusRoomId,
  focusRequest,
  selectedAgentId,
  styles,
  compact,
  actions,
  name,
  onSelectAgent,
  onOpenSession,
  onOpenBoard,
  machine,
  onOpenMachine,
  onOpenResources,
  onOpenLibrary,
  onOpenNotes,
  janitor,
  onOpenJanitor,
  meeting,
  incidents,
  onOpenIncidents,
  onSceneProblem,
  platform,
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
  if (!office.loaded || view === "pending") {
    return <Text style={styles.sceneStatus}>Loading...</Text>;
  }
  if (view === "3d") {
    const World = worldViewFor(platform);
    return (
      <World
        model={model}
        theme={theme}
        styles={styles}
        focusRoomId={focusRoomId}
        focusRequest={focusRequest}
        selectedAgentId={selectedAgentId}
        onSelectAgent={onSelectAgent}
        onSelectBoard={onOpenBoard}
        machine={machine}
        onOpenMachine={onOpenMachine}
        onOpenResources={onOpenResources}
        onOpenSession={onOpenSession}
        onOpenLibrary={onOpenLibrary}
        onOpenNotes={onOpenNotes}
        meeting={meeting}
        incidents={incidents}
        onOpenIncidents={onOpenIncidents}
        onProblem={onSceneProblem}
      />
    );
  }
  if (view === "2d") {
    return (
      <PixelOffice
        model={model}
        rooms={rooms}
        theme={theme}
        focusRoomId={focusRoomId}
        focusRequest={focusRequest}
        onSelectAgent={onSelectAgent}
        onSelectBoard={onOpenBoard}
        machine={machine}
        onOpenMachine={onOpenMachine}
        janitor={janitor}
        onOpenJanitor={onOpenJanitor}
        meeting={meeting}
      />
    );
  }
  return (
    <StructureView
      rooms={rooms}
      styles={styles}
      compact={compact}
      actions={actions}
      name={name}
      onSelectAgent={onSelectAgent}
      onOpenSession={onOpenSession}
      onOpenBoard={onOpenBoard}
    />
  );
}

interface BoardSheetState {
  /** The room whose board sheet is open. */
  room: OfficeRoom | null;
  open(roomId: string): void;
  close(): void;
}

/** Which room's board sheet is open: none once its room has left or the data stopped being live. */
function useBoardSheet(model: OfficeModel, live: boolean): BoardSheetState {
  const [roomId, setRoomId] = useState<string | null>(null);
  const close = useCallback(() => setRoomId(null), []);
  const room =
    roomId === null || !live
      ? null
      : (model.rooms.find((candidate) => candidate.id === roomId) ?? null);
  return { room, open: setRoomId, close };
}

interface CardOpening {
  open: boolean;
  /** When the card last opened: the notes line's "today", the incidents' ages. */
  openedAt: number;
  show(): void;
  close(): void;
}

/** Whether a card is open, and when it last opened: never open while the data is frozen. */
function useCardOpening(live: boolean): CardOpening {
  const [opened, setOpened] = useState(false);
  const [openedAt, setOpenedAt] = useState(0);
  const show = useCallback(() => {
    setOpenedAt(Date.now());
    setOpened(true);
  }, []);
  const close = useCallback(() => setOpened(false), []);
  return { open: opened && live, openedAt, show, close };
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
  const boardActions = useBoardActions();
  const { machine: reading, cleanUp } = useMachine();
  const [machineOpen, setMachineOpen] = useState(false);
  const openMachine = useCallback(() => setMachineOpen(true), []);
  const closeMachine = useCallback(() => setMachineOpen(false), []);
  const tidy = useJanitor();
  const dismissIncidents = useIncidents();
  const [janitorOpen, setJanitorOpen] = useState(false);
  const openJanitor = useCallback(() => setJanitorOpen(true), []);
  const closeJanitor = useCallback(() => setJanitorOpen(false), []);
  const readNotes = useRpc(notesReadRpc);
  const notesTimeZone = useNotesTimeZone();
  const viewChoice = useViewChoice(layout.platform);
  const model = useMemo(() => buildOfficeModel(office.state), [office.state]);
  const unread = useUnread(office.chat);
  const machine = useMemo(() => namedMachine(reading, model.agents), [reading, model.agents]);
  const rooms = useMemo(
    () => orderRoomsForFocus(model.rooms, focusRoomId),
    [model.rooms, focusRoomId],
  );
  const name = useCallback((author: string) => authorName(author, model.agents), [model.agents]);
  // In error or closed the data is frozen: no strip, no card and no board sheet to act on it.
  const live = office.subscription.status !== "error" && office.subscription.status !== "closed";
  const board = useBoardSheet(model, live);
  const notesCard = useCardOpening(live);
  const { show: openNotes, close: closeNotes } = notesCard;
  const incidentsCard = useCardOpening(live);
  const { show: openIncidents } = incidentsCard;
  const standup = useStandup(model, boardActions.post, live);
  const { close: closeStandup } = standup;
  // One card at a time: the Stand-up card leaves for the notes, and either leaves for the writer.
  const notesFromStandup = useCallback(() => {
    closeStandup();
    openNotes();
  }, [closeStandup, openNotes]);
  const openWriter = useMemo(() => {
    if (navigation === undefined) return undefined;
    return (agentId: string) => {
      closeStandup();
      closeNotes();
      navigation.openAgent({ agentId });
    };
  }, [navigation, closeStandup, closeNotes]);
  const showWorkspace = useMemo(() => {
    if (navigation === undefined) return undefined;
    return (workspaceId: string) => navigation.openWorkspace({ workspaceId });
  }, [navigation]);
  const qa = useQa(model, live);
  const readLog = useScriptLog();
  const reviews = useReviews({
    model,
    post: boardActions.post,
    live,
    showWorkspace,
    showBoard: board.open,
  });
  const library = useLibrary({ model, post: boardActions.post, live, showBoard: board.open });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sceneProblem, setSceneProblem] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const closeCard = useCallback(() => setSelectedId(null), []);
  // The strip is the phone's fast path: it opens the card and brings the agent's desk into view.
  const selectFromStrip = useCallback((agentId: string) => {
    setSelectedId(agentId);
    setFocusRequest((previous) => nextFocusRequest(previous, agentId));
  }, []);
  const openSession = useCallback(
    (agentId: string) => openSessionWith(navigation, agentId),
    [navigation],
  );
  // The panels beside the floor reach this surface through the link: a row press opens the card,
  // as a List row does, and "Open session" shows the session in the area the panel was in.
  const link = useMemo(() => ({ select: setSelectedId, openSession }), [openSession]);
  useOfficeLink(link);
  const openResources = useMemo(
    () => resourcesOpener(navigation, openMachine),
    [navigation, openMachine],
  );
  const retryScene = useCallback(() => setSceneProblem(null), []);
  // Choosing a view asks for 3D anew, so an old failure does not stand in its way.
  const { choose } = viewChoice;
  const changeView = useCallback(
    (next: OfficeViewChoice) => {
      setSceneProblem(null);
      choose(next);
    },
    [choose],
  );
  const view = officeView({ choice: viewChoice.choice, problem: sceneProblem });
  const kept = keptSelection(selectedId, model.agents, live);
  // A selection whose agent left is dropped, so the card does not reopen if that agent returns.
  useEffect(() => {
    if (kept !== selectedId) setSelectedId(kept);
  }, [kept, selectedId]);
  const hostEntry = useMemo(
    (): StripCard | null =>
      machine === null ? null : { title: "Host", note: hostNote(machine), onOpen: openMachine },
    [machine, openMachine],
  );
  const contexts = useMemo(
    () => janitorRows(model.agents.values(), model.waitingOn),
    [model.agents, model.waitingOn],
  );
  const janitorEntry = useMemo((): StripCard | null => {
    const note = janitorNote(contexts);
    return note === null ? null : { title: "Janitor", note, onOpen: openJanitor };
  }, [contexts, openJanitor]);
  const incidents = office.state.incidents;
  const incidentsStripEntry = useMemo(
    () => incidentsEntry(incidents, openIncidents),
    [incidents, openIncidents],
  );
  // The strip's cards, each only while it has something to say. An incident comes first.
  const cards = useMemo(
    () =>
      [
        incidentsStripEntry,
        hostEntry,
        janitorEntry,
        standup.entry,
        reviews.entry,
        qa.entry,
        library.entry,
      ].filter((card) => card !== null),
    [
      incidentsStripEntry,
      hostEntry,
      janitorEntry,
      standup.entry,
      reviews.entry,
      qa.entry,
      library.entry,
    ],
  );
  const selected = kept === null ? null : (model.agents.get(kept) ?? null);
  const selectedActivity = kept === null ? null : (office.state.activity[kept] ?? null);
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <HostSwitches
          wake={office.loaded && live ? office.state.wake : null}
          actions={boardActions}
          styles={styles}
          deviceProblem={viewChoice.unsaved ? UNSAVED_VIEW : null}
          scheduleError={office.state.notes?.scheduleError ?? null}
          incidents={incidents}
        >
          <ViewSwitch
            options={viewChoice.options}
            value={viewChoice.choice}
            onChange={changeView}
            styles={styles}
          />
          <PanelButtons
            navigation={navigation}
            link={link}
            compact={layout.compact}
            touchScreen={touchScreen}
            color={theme.colors.foreground}
            unread={unread}
            styles={styles}
          />
        </HostSwitches>
        {live ? (
          <AttentionStrip
            entries={model.attention}
            cards={cards}
            styles={styles}
            wrap={!layout.compact}
            onSelect={selectFromStrip}
          />
        ) : null}
      </View>
      {viewChoice.choice === "3d" && sceneProblem !== null ? (
        <SceneProblem message={sceneProblem} onRetry={retryScene} styles={styles} />
      ) : null}
      <SurfaceBody
        office={office}
        model={model}
        rooms={rooms}
        view={view}
        theme={theme}
        focusRoomId={focusRoomId}
        focusRequest={focusRequest}
        selectedAgentId={kept}
        styles={styles}
        compact={layout.compact}
        actions={actions}
        name={name}
        onSelectAgent={setSelectedId}
        onOpenSession={navigation ? openSession : undefined}
        onOpenBoard={board.open}
        machine={machine}
        onOpenMachine={openMachine}
        onOpenResources={openResources}
        onOpenLibrary={library.show}
        onOpenNotes={openNotes}
        janitor={janitorEntry?.note ?? null}
        onOpenJanitor={openJanitor}
        meeting={standup.open}
        incidents={incidents}
        onOpenIncidents={openIncidents}
        onSceneProblem={setSceneProblem}
        platform={layout.platform}
      />
      <AgentCard
        agent={selected}
        activity={selectedActivity}
        actions={actions}
        navigation={navigation}
        styles={styles}
        onClose={closeCard}
      />
      <MachineCard
        machine={live ? machine : null}
        open={machineOpen}
        cleanUp={cleanUp}
        styles={styles}
        onClose={closeMachine}
      />
      <JanitorCard
        rows={contexts}
        open={janitorOpen && live}
        tidy={tidy}
        styles={styles}
        onClose={closeJanitor}
      />
      <IncidentsCard
        state={incidents}
        open={incidentsCard.open}
        now={incidentsCard.openedAt}
        onDismiss={dismissIncidents}
        styles={styles}
        onClose={incidentsCard.close}
      />
      <StandupCard
        teams={standup.teams}
        open={standup.open}
        ask={standup.ask}
        wakesPaused={office.state.wake.paused}
        notes={office.state.notes}
        now={standup.at}
        timeZone={notesTimeZone}
        onOpenAgent={openWriter}
        onOpenNotes={notesFromStandup}
        styles={styles}
        onClose={standup.close}
      />
      <NotesCard
        open={notesCard.open}
        notes={office.state.notes}
        now={notesCard.openedAt}
        timeZone={notesTimeZone}
        read={readNotes}
        onOpenAgent={openWriter}
        styles={styles}
        onClose={closeNotes}
      />
      <ReviewCard
        rows={reviews.rows}
        open={reviews.open}
        ask={reviews.ask}
        wakesPaused={office.state.wake.paused}
        onOpenWorkspace={reviews.openWorkspace}
        onOpenBoard={reviews.openBoard}
        styles={styles}
        onClose={reviews.close}
      />
      <QaCard
        teams={qa.teams}
        open={qa.open}
        readLog={readLog}
        styles={styles}
        onClose={qa.close}
      />
      <LibraryCard
        teams={library.teams}
        skills={library.skills}
        readFailure={library.readFailure}
        open={library.open}
        read={library.read}
        teach={library.teach}
        wakesPaused={office.state.wake.paused}
        onOpenBoard={library.openBoard}
        styles={styles}
        onClose={library.close}
      />
      <BoardSheet
        room={board.room}
        rooms={model.rooms}
        agentTasks={model.agentTasks}
        name={name}
        actions={boardActions}
        wakesPaused={office.state.wake.paused}
        sheetLeavesFirst={sheetLeavesFirstOn(layout.compact, layout.platform)}
        styles={styles}
        onClose={board.close}
      />
    </View>
  );
}
