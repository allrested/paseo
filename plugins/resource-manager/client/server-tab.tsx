import { useQuery } from "@tanstack/react-query";
import { Text, View } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsRow, SettingsSection } from "@getpaseo/plugin/client/ui";
import { serverRpc, type RemoteSnapshot, type ServerEntry } from "../shared/rpc.js";
import {
  formatClock,
  mountRow,
  processRow,
  readingView,
  serverRows,
  type HostCard,
  type SectionTitles,
} from "./format.js";
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
  titles: SectionTitles;
}

interface ErrorSectionProps {
  title: string;
  message: string;
  styles: ScreenStyles;
}

interface HostSectionsProps {
  card: HostCard;
  styles: ScreenStyles;
}

function SnapshotSections({ snapshot, readAt, titles }: SnapshotSectionsProps) {
  const mounts = snapshot.mounts.map(mountRow);
  const processes = snapshot.processes.map(processRow);
  return (
    <>
      <SettingsSection title={titles.summary}>
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
      <SettingsSection title={titles.disks}>
        <SettingsCard>
          {mounts.length === 0 ? <SettingsRow label="No disks reported" /> : null}
          {mounts.map((row) => (
            <SettingsRow key={row.key} label={row.label} hint={row.value} />
          ))}
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title={titles.processes}>
        <SettingsCard>
          {processes.map((row) => (
            <SettingsRow key={row.key} label={row.label} hint={row.value} />
          ))}
        </SettingsCard>
      </SettingsSection>
    </>
  );
}

function ErrorSection({ title, message, styles }: ErrorSectionProps) {
  return (
    <SettingsSection title={title}>
      <Text accessibilityRole="alert" style={styles.error}>
        {message}
      </Text>
    </SettingsSection>
  );
}

function HostSections({ card, styles }: HostSectionsProps) {
  return (
    <>
      {card.error === null ? null : (
        <ErrorSection title={card.titles.error} message={card.error} styles={styles} />
      )}
      {card.snapshot ? (
        <SnapshotSections snapshot={card.snapshot} readAt={card.readAt} titles={card.titles} />
      ) : null}
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
  const view = readingView(data, reading.isError ? reading.error.message : null);
  return (
    <View style={styles.stack}>
      <Text style={styles.muted}>{server.source}</Text>
      {data === undefined && !reading.isError ? (
        <Text style={styles.muted}>Reading {server.name}...</Text>
      ) : null}
      {view.error === null ? null : (
        <ErrorSection title="Unable to read this server" message={view.error} styles={styles} />
      )}
      {view.cards.map((card) => (
        <HostSections key={card.key} card={card} styles={styles} />
      ))}
    </View>
  );
}
