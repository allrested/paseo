import { useQuery } from "@tanstack/react-query";
import { Text, View } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsRow, SettingsSection } from "@getpaseo/plugin/client/ui";
import { serverRpc, type RemoteSnapshot, type ServerEntry } from "../shared/rpc.js";
import { formatClock, mountRow, processRow, serverRows } from "./format.js";
import type { ScreenStyles } from "./styles.js";

const POLL_MS = 30_000;

interface ServerTabProps {
  server: ServerEntry;
  hostId: string;
  styles: ScreenStyles;
}

interface SnapshotSectionsProps {
  snapshot: RemoteSnapshot;
  readAt: string | null;
}

function SnapshotSections({ snapshot, readAt }: SnapshotSectionsProps) {
  const mounts = snapshot.mounts.map(mountRow);
  const processes = snapshot.processes.map(processRow);
  return (
    <>
      <SettingsSection title="Server">
        <SettingsCard>
          {serverRows(snapshot).map((row) => (
            <SettingsRow key={row.key} label={row.label} hint={row.value} />
          ))}
          <SettingsRow
            label="Last reading"
            hint={readAt === null ? "None yet" : formatClock(readAt)}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Disks">
        <SettingsCard>
          {mounts.length === 0 ? <SettingsRow label="No disks reported" /> : null}
          {mounts.map((row) => (
            <SettingsRow key={row.key} label={row.label} hint={row.value} />
          ))}
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Top processes">
        <SettingsCard>
          {processes.map((row) => (
            <SettingsRow key={row.key} label={row.label} hint={row.value} />
          ))}
        </SettingsCard>
      </SettingsSection>
    </>
  );
}

// Mounted only while its tab is selected, so the 30 s poll stops when the tab closes; the
// server's session then closes 2 minutes after the last read.
export function ServerTab({ server, hostId, styles }: ServerTabProps) {
  const fetchServer = useRpc(serverRpc);
  const reading = useQuery({
    queryKey: ["resource-manager", hostId, "server", server.id],
    queryFn: () => fetchServer({ id: server.id }),
    refetchInterval: POLL_MS,
    retry: false,
  });
  const data = reading.data;
  const error = reading.isError ? reading.error.message : (data?.error ?? null);
  return (
    <View style={styles.stack}>
      <Text style={styles.muted}>{server.source}</Text>
      {data === undefined && !reading.isError ? (
        <Text style={styles.muted}>Reading {server.name}...</Text>
      ) : null}
      {error === null ? null : (
        <SettingsSection title="Unable to read this server">
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        </SettingsSection>
      )}
      {data?.snapshot ? <SnapshotSections snapshot={data.snapshot} readAt={data.readAt} /> : null}
    </View>
  );
}
