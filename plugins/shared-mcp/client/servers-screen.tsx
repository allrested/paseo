import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  SettingsSection,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { restartRpc, statusRpc, type ServerStatus } from "../shared/rpc.js";
import { sharedMcpSettings, type ServerDefinition } from "../shared/settings.js";
import { withServerEnabled } from "./definitions.js";
import { describeServer, formatLogTail } from "./format.js";
import { useScreenStyles, type ScreenStyles } from "./styles.js";

const STATUS_KEY = ["shared-mcp", "status"] as const;
const POLL_MS = 5_000;
const LOG_TAIL_LINES = 20;
const NO_DEFINITIONS: readonly ServerDefinition[] = [];
const EMPTY_MESSAGE = "No servers are defined. Add them on the Definitions tab.";

type SharedMcpSettingsState = SettingsState<typeof sharedMcpSettings.schema>;

interface ServerCardProps {
  server: ServerStatus;
  definitions: readonly ServerDefinition[];
  settings: SharedMcpSettingsState;
  /** When the status was fetched. Uptime and retry countdowns are measured from it. */
  now: number;
  styles: ScreenStyles;
}

interface StatusUnavailableProps {
  message: string;
  onRetry(): void;
  styles: ScreenStyles;
}

function restartBlockedReason(state: ServerStatus["state"]): string | undefined {
  if (state === "external") return "Paseo did not start this server, so it leaves it alone";
  if (state === "disabled") return "Turn the server on to start it";
  return undefined;
}

function settingsMessage(settings: SharedMcpSettingsState): string | null {
  if (settings.status === "invalid") {
    return `The saved definitions are invalid. Fix them on the Definitions tab.\n${settings.error}`;
  }
  if (settings.status === "error") return settings.error;
  return settings.saveError;
}

function ServerCard({ server, definitions, settings, now, styles }: ServerCardProps) {
  const callRestart = useRpc(restartRpc);
  const queryClient = useQueryClient();
  const restart = useMutation({
    mutationFn: () => callRestart({ id: server.id }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: STATUS_KEY }),
  });
  const { mutate } = restart;
  const restartServer = useCallback(() => mutate(), [mutate]);
  const changeEnabled = useCallback(
    async (next: boolean) => {
      if (settings.status !== "ready") return;
      const servers = withServerEnabled(settings.values.servers, server.id, next);
      const saved = await settings.save({ ...settings.values, servers }, settings.revision);
      // Refetch now so the switch and the state line do not disagree until the next poll.
      // save() never throws; false means nothing was saved, so the status is unchanged.
      if (saved) await queryClient.invalidateQueries({ queryKey: STATUS_KEY });
    },
    [settings, server.id, queryClient],
  );
  const definition = definitions.find((candidate) => candidate.id === server.id);
  // Until the definition loads, or once it is removed, the switch mirrors the process state.
  const enabled = definition ? definition.enabled : server.state !== "disabled";
  const canToggle = definition !== undefined && !settings.saving;
  const blockedReason = restartBlockedReason(server.state);
  const canRestart = blockedReason === undefined && !restart.isPending;
  const reply = restart.data;
  const rejection = reply?.ok === false ? reply.error : null;
  const restartError = restart.error?.message ?? rejection;
  const summary = describeServer(server, now);
  return (
    <SettingsCard>
      <SettingsSwitch
        label={server.label}
        hint={summary}
        error={server.lastError}
        value={enabled}
        disabled={!canToggle}
        onValueChange={changeEnabled}
      />
      <SettingsAction
        label="Restart server"
        hint={blockedReason}
        error={restartError}
        actionLabel={restart.isPending ? "Restarting..." : "Restart"}
        disabled={!canRestart}
        onPress={restartServer}
      />
      <View style={styles.block}>
        <Text selectable style={styles.log}>
          {formatLogTail(server.logTail, LOG_TAIL_LINES)}
        </Text>
      </View>
    </SettingsCard>
  );
}

function StatusUnavailable({ message, onRetry, styles }: StatusUnavailableProps) {
  return (
    <SettingsSection title="Servers">
      <Text accessibilityRole="alert" style={styles.error}>
        {message}
      </Text>
      <SettingsAction label="Server status" actionLabel="Try again" onPress={onRetry} />
    </SettingsSection>
  );
}

export function ServersScreen({ theme }: PluginSurfaceProps) {
  const styles = useScreenStyles(theme);
  const settings = useSettings(sharedMcpSettings);
  const fetchStatus = useRpc(statusRpc);
  // The interval belongs to the query observer, so polling stops when the screen unmounts.
  // The installation's QueryClient keeps TanStack's default of 3 retries with backoff, which
  // would hide a failed fetch for about 7 s; the next poll is the retry.
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
  const servers = status.data?.servers;
  if (servers === undefined) {
    if (status.isError) {
      return <StatusUnavailable message={status.error.message} onRetry={retry} styles={styles} />;
    }
    return <Text style={styles.muted}>Loading servers...</Text>;
  }
  const definitions = settings.status === "ready" ? settings.values.servers : NO_DEFINITIONS;
  const refreshError = status.isError ? `Status refresh failed: ${status.error.message}` : null;
  const settingsError = settingsMessage(settings);
  return (
    <SettingsSection title="Servers">
      {refreshError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {refreshError}
        </Text>
      ) : null}
      {settingsError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {settingsError}
        </Text>
      ) : null}
      {servers.length === 0 ? <Text style={styles.muted}>{EMPTY_MESSAGE}</Text> : null}
      {servers.map((server) => (
        <ServerCard
          key={server.id}
          server={server}
          definitions={definitions}
          settings={settings}
          now={status.dataUpdatedAt}
          styles={styles}
        />
      ))}
    </SettingsSection>
  );
}
