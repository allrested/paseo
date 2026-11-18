import { useMemo } from "react";
import { View } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { HostSwitches } from "./host-switches.js";
import { UNSAVED_VIEW, hasTouchScreen, readPointer, useViewChoice } from "./office-surface.js";
import { useOfficeStyles } from "./styles.js";
import { useBoardActions } from "./use-board-actions.js";
import { useOffice } from "./use-office.js";
import { ViewSwitch } from "./view-switch.js";

/**
 * The office's settings, under the app's Settings: what the host holds (wakes, agent tools, the
 * stand-up notes, the incident trackers) and this device's view. The office's page shows none of
 * them, so a phone's floor is not covered.
 */
export function OfficeSettings({ theme, layout }: PluginSurfaceProps) {
  const touchScreen = useMemo(
    () => hasTouchScreen(layout.platform, layout.platform === "web" ? readPointer() : null),
    [layout.platform],
  );
  const styles = useOfficeStyles(theme, layout.compact, touchScreen);
  const office = useOffice();
  const actions = useBoardActions();
  const view = useViewChoice(layout.platform);
  // Frozen data says nothing of the wakes: the switch is then not usable.
  const live = office.subscription.status !== "error" && office.subscription.status !== "closed";
  return (
    <View style={styles.header}>
      <HostSwitches
        wake={office.loaded && live ? office.state.wake : null}
        actions={actions}
        styles={styles}
        deviceProblem={view.unsaved ? UNSAVED_VIEW : null}
        scheduleError={office.state.notes?.scheduleError ?? null}
        incidents={office.state.incidents}
      >
        <ViewSwitch
          options={view.options}
          value={view.choice}
          onChange={view.choose}
          styles={styles}
        />
      </HostSwitches>
    </View>
  );
}
