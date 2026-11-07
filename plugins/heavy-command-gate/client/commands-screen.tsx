import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { mergeStatus, type StatusOutcome, type StatusResult } from "./status-result.js";
import { useScreenStyles, type ScreenStyles } from "./styles.js";

// The tag ties the key to the data type, so reading the cache with it needs no cast.
const STATUS_KEY = queryOptions<StatusResult>({
  queryKey: ["heavy-command-gate", "status"],
}).queryKey;
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
  const queryClient = useQueryClient();
  // A failed request resolves to data, it does not throw: a query without data drops to pending at
  // every fetch, which would unmount the card and its switch each time. So the query never holds
  // an error and TanStack never retries; the next poll is the retry. The interval belongs to the
  // query observer, so polling stops when the screen unmounts.
  const status = useQuery({
    queryKey: STATUS_KEY,
    queryFn: async () => {
      let outcome: StatusOutcome;
      try {
        outcome = { ok: true, status: await fetchStatus({}) };
      } catch (error) {
        outcome = { ok: false, error };
      }
      // The key's tag types this read only while nothing expects a type here, so it goes into a
      // local before `mergeStatus` sees it.
      const previous = queryClient.getQueryData(STATUS_KEY);
      return mergeStatus(previous, outcome);
    },
    refetchInterval: POLL_MS,
  });
  const { refetch } = status;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);
  const data = status.data;
  if (data === undefined) {
    return <Text style={styles.muted}>Loading heavy commands...</Text>;
  }
  if (data.status === null) {
    return (
      <StatusUnavailable
        message={data.error}
        retrying={status.isFetching}
        settings={settings}
        onRetry={retry}
        styles={styles}
      />
    );
  }
  const refreshError = data.error === null ? null : `Status refresh failed: ${data.error}`;
  return (
    <>
      <SettingsSection title="Heavy commands" info={COMMANDS_INFO}>
        <SettingsCard>
          <GateSwitch settings={settings} status={data.status} />
          {refreshError ? (
            <View style={styles.block}>
              <Text accessibilityRole="alert" style={styles.error}>
                {refreshError}
              </Text>
            </View>
          ) : null}
        </SettingsCard>
      </SettingsSection>
      <RunningList status={data.status} styles={styles} />
      <WaitingList status={data.status} styles={styles} />
    </>
  );
}
