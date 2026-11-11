import { useCallback, useEffect, useMemo, useState } from "react";
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
import { fakeOffice } from "./scene/fake-office.js";
import { SceneView, type FocusRequest } from "./scene/scene-view.js";
import { hasWebGL2 } from "./scene/web-env.web.js";
import { StructureView } from "./structure-view.js";
import { useOfficeStyles, type OfficeStyles } from "./styles.js";
import { useAgentActions, type AgentActions } from "./use-agent-actions.js";
import { useOffice, type OfficeState } from "./use-office.js";

export type OfficeSurfaceProps = PluginScreenProps | PluginWorkspacePanelProps;

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

interface ThreeDState {
  /** Web with WebGL2: the switch is shown. */
  available: boolean;
  /** The switch's position; null while the device's setting is being read. */
  on: boolean | null;
  toggle(next: boolean): void;
}

/** The per-device 3D switch. Off, and everywhere 3D is unavailable, three.js is never loaded. */
function useThreeD(platform: OfficeSurfaceProps["layout"]["platform"]): ThreeDState {
  const settings = useSettings(officeDeviceSettings);
  const available = useMemo(() => platform === "web" && hasWebGL2(), [platform]);
  // The view follows the switch at once. A choice the device could not store stays here, so the
  // switch still does what it says until the surface closes.
  const [unsaved, setUnsaved] = useState<boolean | null>(null);
  const revision =
    settings.status === "ready" || settings.status === "invalid" ? settings.revision : null;
  const { save } = settings;
  const toggle = useCallback(
    (next: boolean) => {
      async function store(): Promise<void> {
        setUnsaved(next);
        if (revision !== null && (await save({ threeD: next }, revision))) setUnsaved(null);
      }
      void store();
    },
    [save, revision],
  );
  return { available, on: available ? (unsaved ?? savedThreeD(settings)) : false, toggle };
}

interface ThreeDSwitchProps {
  /** Null while the device's setting is being read: drawn on, the default, and not yet usable. */
  value: boolean | null;
  onChange(next: boolean): void;
  styles: OfficeStyles;
}

/**
 * Drawn here because a plugin cannot import the app's switch
 * (packages/app/src/components/ui/switch.tsx): the same role, state and sizes. react-native's
 * Switch is 40 x 20 on web whatever the pointer, and its thumb is a fixed teal while on. The
 * label is inside the target, so the row is 44 px tall on a touch screen and says what it turns.
 */
function ThreeDSwitch({ value, onChange, styles }: ThreeDSwitchProps) {
  const on = value ?? true;
  const disabled = value === null;
  const flip = useCallback(() => onChange(!on), [onChange, on]);
  return (
    <Pressable
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

function SceneProblem({ message, onRetry, styles }: SceneProblemProps) {
  return (
    <View style={styles.banner}>
      <Text accessibilityRole="alert" style={styles.bannerText}>
        Unable to show the 3D view: {message}
      </Text>
      <View style={styles.actions}>
        <ActionButton
          label="Try 3D again"
          pendingLabel="Trying..."
          onPress={onRetry}
          styles={styles}
        />
      </View>
    </View>
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
  styles: OfficeStyles;
  actions: AgentActions;
  onSelectAgent(agentId: string): void;
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
  styles,
  actions,
  onSelectAgent,
  onSceneProblem,
}: SurfaceBodyProps) {
  if (office.subscription.status === "error") {
    return (
      <Text accessibilityRole="alert" style={styles.error}>
        Unable to load the office: {office.subscription.error.message}
      </Text>
    );
  }
  // Closed means the plugin's handler finished, and the hook does not subscribe again: without
  // this the rows would stay on screen and never change.
  if (office.subscription.status === "closed") {
    return (
      <Text accessibilityRole="alert" style={styles.error}>
        Unable to show live agents: the host closed the office. Reopen it
      </Text>
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
        onSelectAgent={onSelectAgent}
        onProblem={onSceneProblem}
      />
    );
  }
  return (
    <StructureView rooms={rooms} styles={styles} actions={actions} onSelectAgent={onSelectAgent} />
  );
}

/** One surface for both places: the sidebar screen and a workspace tab. */
export function OfficeSurface(props: OfficeSurfaceProps) {
  const { theme, layout, navigation } = props;
  const focusRoomId = "workspaceId" in props ? props.workspaceId : null;
  const styles = useOfficeStyles(theme, layout.compact);
  const office = useOffice();
  const actions = useAgentActions();
  const threeD = useThreeD(layout.platform);
  const model = useMemo(() => buildOfficeModel(office.state), [office.state]);
  const rooms = useMemo(
    () => orderRoomsForFocus(model.rooms, focusRoomId),
    [model.rooms, focusRoomId],
  );
  // Until the owner approves the look, the scene draws a fixed fake office.
  const fakeModel = useMemo(() => buildOfficeModel(fakeOffice()), []);
  // In error or closed the data is frozen: no strip and no card to act on it.
  const live = office.subscription.status !== "error" && office.subscription.status !== "closed";
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sceneProblem, setSceneProblem] = useState<string | null>(null);
  const [focusRequest] = useState<FocusRequest | null>(null);
  const closeCard = useCallback(() => setSelectedId(null), []);
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
  const showScene = view === "scene";
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
          <AttentionStrip entries={model.attention} styles={styles} onSelect={setSelectedId} />
        ) : null}
      </View>
      {view === "fallback" && sceneProblem !== null ? (
        <SceneProblem message={sceneProblem} onRetry={retryScene} styles={styles} />
      ) : null}
      <SurfaceBody
        office={office}
        rooms={rooms}
        sceneModel={showScene ? fakeModel : null}
        waiting={view === "pending"}
        theme={theme}
        focusRoomId={focusRoomId}
        focusRequest={focusRequest}
        styles={styles}
        actions={actions}
        onSelectAgent={setSelectedId}
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
