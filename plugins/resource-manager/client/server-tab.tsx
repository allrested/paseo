import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import { serverRpc, type ServerEntry } from "../shared/rpc.js";
import { DetailBlockView, ResourceCard, TrendBlock, type CardsState } from "./card-views.js";
import {
  areAllOpen,
  formatAge,
  overviewText,
  snapshotDetails,
  snapshotSample,
  snapshotSummary,
  sortWorstFirst,
  trendLines,
  type CardSummary,
  type TrendPoint,
} from "./cards.js";
import { readingView, type HostCard } from "./format.js";
import type { ScreenStyles } from "./styles.js";

const POLL_MS = 30_000;
const NO_POINTS: readonly TrendPoint[] = [];

interface ServerTabProps {
  server: ServerEntry;
  hostId: string;
  cards: CardsState;
  styles: ScreenStyles;
}

interface Host {
  /** The card's key among the open cards and in the trend: unique across tabs. */
  id: string;
  card: HostCard;
  summary: CardSummary;
}

interface HostCardViewProps {
  host: Host;
  /** When the tab last heard from the daemon, for the reading's age. */
  now: number;
  open: boolean;
  points: readonly TrendPoint[];
  onToggle(id: string): void;
  styles: ScreenStyles;
}

function HostCardView({ host, now, open, points, onToggle, styles }: HostCardViewProps) {
  const { card, summary } = host;
  const { snapshot } = card;
  const age = formatAge(card.readAt, now);
  return (
    <ResourceCard
      id={host.id}
      title={card.name}
      meta={card.address === null ? age : `${card.address} · ${age}`}
      summary={summary}
      expandable={snapshot !== null}
      open={open}
      onToggle={onToggle}
      styles={styles}
    >
      {snapshot === null || !open
        ? null
        : snapshotDetails(snapshot, card.readAt).map((block) => (
            <DetailBlockView key={block.key} block={block} styles={styles} />
          ))}
      {snapshot === null || !open ? null : (
        <TrendBlock lines={trendLines(points, snapshot.cores)} styles={styles} />
      )}
    </ResourceCard>
  );
}

interface OverviewProps {
  hosts: readonly Host[];
  cards: CardsState;
  styles: ScreenStyles;
}

function Overview({ hosts, cards, styles }: OverviewProps) {
  const ids = useMemo(() => hosts.map((host) => host.id), [hosts]);
  const allOpen = areAllOpen(cards.open, ids);
  const { setAll } = cards;
  const press = useCallback(() => setAll(ids, !allOpen), [setAll, ids, allOpen]);
  // A host with no reading has nothing to open.
  const canOpen = hosts.some((host) => host.card.snapshot !== null);
  return (
    <View style={styles.overview}>
      <Text style={styles.overviewText}>
        {overviewText(hosts.map((host) => host.summary.status))}
      </Text>
      {canOpen ? (
        <Pressable accessibilityRole="button" onPress={press}>
          <Text style={styles.link}>{allOpen ? "Collapse all" : "Expand all"}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// Mounted only while its tab is selected, so the 30 s poll stops when the tab closes; the
// server's session then closes 2 minutes after the last read.
export function ServerTab({ server, hostId, cards, styles }: ServerTabProps) {
  const fetchServer = useRpc(serverRpc);
  const reading = useQuery({
    queryKey: ["resource-manager", hostId, "server", server.id],
    queryFn: () => fetchServer({ id: server.id }),
    refetchInterval: POLL_MS,
    retry: false,
  });
  const data = reading.data;
  const requestError = reading.isError ? reading.error.message : null;
  const view = useMemo(
    () => readingView(data, requestError, server.name),
    [data, requestError, server.name],
  );
  // Worst first, so the host that needs attention is the one under the thumb.
  const hosts = useMemo(
    () =>
      sortWorstFirst(
        view.cards.map(
          (card): Host => ({
            id: `${server.id}/${card.key}`,
            card,
            summary: snapshotSummary(card.snapshot, card.error),
          }),
        ),
        (host) => host.summary.status,
      ),
    [view, server.id],
  );
  const { record } = cards;
  useEffect(() => {
    record(hosts.map((host) => snapshotSample(host.id, host.card.snapshot, host.card.readAt)));
  }, [record, hosts]);
  // Ages move when a poll lands or fails, not on a timer of their own.
  const now = Math.max(reading.dataUpdatedAt, reading.errorUpdatedAt);
  return (
    <View style={styles.stack}>
      <Text style={styles.muted}>{server.source}</Text>
      {data === undefined && !reading.isError ? (
        <Text style={styles.muted}>Reading {server.name}...</Text>
      ) : null}
      {view.error === null ? null : (
        <Text accessibilityRole="alert" style={styles.error}>
          Unable to read this server: {view.error}
        </Text>
      )}
      {hosts.length > 1 ? <Overview hosts={hosts} cards={cards} styles={styles} /> : null}
      <View style={styles.cards}>
        {hosts.map((host) => (
          <HostCardView
            key={host.id}
            host={host}
            now={now}
            open={cards.open.has(host.id)}
            points={cards.trend.get(host.id) ?? NO_POINTS}
            onToggle={cards.toggle}
            styles={styles}
          />
        ))}
      </View>
    </View>
  );
}
