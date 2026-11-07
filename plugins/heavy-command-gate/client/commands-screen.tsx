import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { Text, View } from "react-native";
import {
  useRpc,
  useSettings,
  type PluginSurfaceProps,
  type SettingsState,
} from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { statusRpc, type GateStatus } from "../shared/rpc.js";
import { gateSettings } from "../shared/settings.js";
import { describeGate, describeRunning, describeWaiting } from "./format.js";
import { useScreenStyles, type ScreenStyles } from "./styles.js";

const STATUS_KEY = ["heavy-command-gate", "status"] as const;
const POLL_MS = 5_000;
const COMMANDS_INFO = `Heavy commands that agents start through npm, npx, pnpm, tsc, tsgo, vitest, jest, gradle, gradlew or pytest wait here for a slot and for free memory. The lists refresh every ${POLL_MS / 1000} s.`;

type GateSettingsState = SettingsState<typeof gateSettings.schema>;

interface GateSwitchProps {
  settings: GateSettingsState;
  /** Null when the status request failed: the switch then shows the settings alone. */
  status: GateStatus | null;
}

interface CommandListProps {
  status: GateStatus;
  styles: ScreenStyles;
}

interface StatusUnavailableProps {
  message: string;
  /** The status request is in flight again. */
  retrying: boolean;
  settings: GateSettingsState;
  onRetry(): void;
  styles: ScreenStyles;
}

function settingsMessage(settings: GateSettingsState): string | null {
  if (settings.status === "invalid") {
    return `The saved settings are invalid. Restore the defaults on the Limits tab.\n${settings.error}`;
  }
  if (settings.status === "error") return settings.error;
  return settings.saveError;
}

function GateSwitch({ settings, status }: GateSwitchProps) {
  const queryClient = useQueryClient();
  const changeEnabled = useCallback(
    async (next: boolean) => {
      if (settings.status !== "ready") return;
      const saved = await settings.save({ ...settings.values, enabled: next }, settings.revision);
      // Refetch now, so the switch and its hint agree before the next poll.
      if (saved) await queryClient.invalidateQueries({ queryKey: STATUS_KEY });
    },
    [settings, queryClient],
  );
  // Until the settings load, the switch mirrors what the gate reports, or reads off when the
  // status request failed.
  const enabled =
    settings.status === "ready"
      ? settings.values.enabled
      : status !== null && status.state !== "off";
  return (
    <SettingsSwitch
      label="Gate heavy commands"
      hint={status === null ? undefined : describeGate(status)}
      error={settingsMessage(settings)}
      value={enabled}
      disabled={settings.status !== "ready" || settings.saving}
      onValueChange={changeEnabled}
    />
  );
}

function RunningList({ status, styles }: CommandListProps) {
  return (
    <SettingsSection title="Running">
      <SettingsCard>
        {status.running.length === 0 ? (
          <View style={styles.block}>
            <Text style={styles.muted}>Nothing running</Text>
          </View>
        ) : (
          status.running.map((command) => (
            <SettingsRow key={command.id} label={command.command} hint={describeRunning(command)} />
          ))
        )}
      </SettingsCard>
    </SettingsSection>
  );
}

function WaitingList({ status, styles }: CommandListProps) {
  return (
    <SettingsSection title="Waiting">
      <SettingsCard>
        {status.waiting.length === 0 ? (
          <View style={styles.block}>
            <Text style={styles.muted}>Nothing waiting</Text>
          </View>
        ) : (
          status.waiting.map((command) => (
            <SettingsRow key={command.id} label={command.command} hint={describeWaiting(command)} />
          ))
        )}
      </SettingsCard>
    </SettingsSection>
  );
}

function StatusUnavailable({
  message,
  retrying,
  settings,
  onRetry,
  styles,
}: StatusUnavailableProps) {
  return (
    <SettingsSection title="Heavy commands">
      <SettingsCard>
        <View style={styles.block}>
          <Text accessibilityRole="alert" style={styles.error}>
            {message}
          </Text>
        </View>
        <SettingsAction
          label="Gate status"
          actionLabel={retrying ? "Loading..." : "Try again"}
          disabled={retrying}
          onPress={onRetry}
        />
        <GateSwitch settings={settings} status={null} />
      </SettingsCard>
    </SettingsSection>
  );
}

export function CommandsScreen({ theme }: PluginSurfaceProps) {
  const styles = useScreenStyles(theme);
  const settings = useSettings(gateSettings);
  const fetchStatus = useRpc(statusRpc);
  // The interval belongs to the query observer, so polling stops when the screen unmounts. The
  // next poll is the retry: TanStack's default retries would hide a failed fetch for about 7 s.
  const status = useQuery({
    queryKey: STATUS_KEY,
    queryFn: () => fetchStatus({}),
    refetchInterval: POLL_MS,
    retry: false,
  });
  const { refetch } = status;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);
  const data = status.data;
  if (data === undefined) {
    if (status.isError) {
      return (
        <StatusUnavailable
          message={status.error.message}
          retrying={status.isFetching}
          settings={settings}
          onRetry={retry}
          styles={styles}
        />
      );
    }
    return <Text style={styles.muted}>Loading heavy commands...</Text>;
  }
  const refreshError = status.isError ? `Status refresh failed: ${status.error.message}` : null;
  return (
    <>
      <SettingsSection title="Heavy commands" info={COMMANDS_INFO}>
        <SettingsCard>
          <GateSwitch settings={settings} status={data} />
          {refreshError ? (
            <View style={styles.block}>
              <Text accessibilityRole="alert" style={styles.error}>
                {refreshError}
              </Text>
            </View>
          ) : null}
        </SettingsCard>
      </SettingsSection>
      <RunningList status={data} styles={styles} />
      <WaitingList status={data} styles={styles} />
    </>
  );
}
