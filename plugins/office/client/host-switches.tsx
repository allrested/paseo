import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { useSettings, type SettingsState } from "@getpaseo/plugin/client";
import type { WakeState } from "../shared/contracts.js";
import { officeHostSettings } from "../shared/settings.js";
import { failureText } from "./action-button.js";
import { wakeSummary } from "./board-text.js";
import { LabeledSwitch } from "./labeled-switch.js";
import type { OfficeStyles } from "./styles.js";
import type { BoardActions } from "./use-board-actions.js";

type HostSettings = SettingsState<typeof officeHostSettings.schema>;

/**
 * "Agent tools" as the host holds it. A setting that is not valid counts as on, as the host
 * itself reads it, and a tap overwrites it; null while it is read or cannot be read.
 */
function storedTools(settings: HostSettings): boolean | null {
  if (settings.status === "ready") return settings.values.agentTools;
  return settings.status === "invalid" ? true : null;
}

export interface HostSwitchesProps {
  /** Null until the office has loaded and while its data is frozen: the switch is then not usable. */
  wake: WakeState | null;
  actions: BoardActions;
  styles: OfficeStyles;
  /** A failure of the device's own switch, shown under the row with the host's. */
  deviceProblem: string | null;
  /** The device's own switch: last in the row, so on a phone it wraps to the line above the view. */
  children?: ReactNode;
}

/**
 * The header's switches. Host-wide: "Wake agents" pauses every wake, and "Agent tools" adds the
 * board tools to sessions opened from then on. Each follows the tap at once and goes back if the
 * host refuses it, with the reason on a line under the row.
 */
export function HostSwitches({
  wake,
  actions,
  styles,
  deviceProblem,
  children,
}: HostSwitchesProps) {
  const settings = useSettings(officeHostSettings);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // The tap, until the host has answered it.
  const [wantedWakes, setWantedWakes] = useState<boolean | null>(null);
  const [wakeProblem, setWakeProblem] = useState<string | null>(null);
  const toggleWakes = useCallback(
    (next: boolean) => {
      setWantedWakes(next);
      setWakeProblem(null);
      actions
        .setWakesPaused(!next)
        .catch((failure: unknown) => {
          const label = next ? "Turn Wake agents on" : "Turn Wake agents off";
          if (mounted.current) setWakeProblem(failureText(label, failure));
        })
        .finally(() => {
          if (mounted.current) setWantedWakes(null);
        });
    },
    [actions],
  );
  const stored = storedTools(settings);
  const revision =
    settings.status === "ready" || settings.status === "invalid" ? settings.revision : null;
  const [wantedTools, setWantedTools] = useState<boolean | null>(null);
  const { save, saveError } = settings;
  const toggleTools = useCallback(
    (next: boolean) => {
      if (revision === null) return;
      setWantedTools(next);
      // Never rejects: a refused save leaves its reason in saveError.
      void save({ agentTools: next }, revision).finally(() => {
        if (mounted.current) setWantedTools(null);
      });
    },
    [save, revision],
  );
  const summary = wake === null ? null : wakeSummary(wake);
  const wakesOn = wake === null ? null : !wake.paused;
  const problems = [
    wakeProblem,
    settings.status === "error"
      ? failureText("Read the Agent tools setting", settings.error)
      : null,
    saveError === null ? null : failureText("Save the Agent tools setting", saveError),
    deviceProblem,
  ].filter((problem): problem is string => problem !== null);
  return (
    <>
      <View style={styles.headerControls}>
        <LabeledSwitch
          label="Wake agents"
          note={summary}
          value={wantedWakes ?? wakesOn}
          onChange={toggleWakes}
          styles={styles}
        />
        <LabeledSwitch
          label="Agent tools"
          value={wantedTools ?? stored}
          onChange={toggleTools}
          styles={styles}
        />
        {children}
      </View>
      {problems.length > 0 ? (
        <View style={styles.headerProblems}>
          {problems.map((problem) => (
            <Text key={problem} accessibilityRole="alert" style={styles.actionError}>
              {problem}
            </Text>
          ))}
        </View>
      ) : null}
    </>
  );
}
