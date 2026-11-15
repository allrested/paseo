import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { Icon, ScrollView } from "@getpaseo/plugin/client/ui";
import { seenRpc, type FeedEntry, type FeedKind } from "../shared/contracts.js";
import { isNew, newCount } from "../shared/feed.js";
import { KIND_LABEL, entryLabel, entryMeta, entryTitle } from "./format.js";
import { useFeedStyles, type FeedStyles } from "./styles.js";
import { useFeed, type LiveFeed } from "./use-feed.js";

const EMPTY =
  "Nothing yet. When an agent on this host finishes a turn, fails or asks for a permission, it shows up here.";
const ICONS: Record<FeedKind, string> = {
  finished: "CircleCheck",
  failed: "CircleAlert",
  permission: "CircleHelp",
};
// "5 min ago" on a screen left open is wrong within the minute.
const TICK_MS = 30_000;

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * Tells the host the feed is seen, when it holds something new. A screen is not told whether it
 * is in front (it stays mounted under the agent it opened), so the two moments that prove it is
 * are the ones used: it opened, and it was pressed.
 */
function useSeen(feed: LiveFeed): () => void {
  const seen = useRpc(seenRpc);
  const fresh = newCount(feed.state);
  const loaded = feed.opened !== null;
  const asking = useRef(false);
  const mark = useCallback(() => {
    if (fresh === 0 || asking.current) return;
    asking.current = true;
    // A call that fails leaves the count as it was; the next press asks again.
    seen({}).then(
      () => void (asking.current = false),
      () => void (asking.current = false),
    );
  }, [fresh, seen]);
  const marked = useRef(false);
  useEffect(() => {
    if (!loaded || marked.current) return;
    marked.current = true;
    mark();
  }, [loaded, mark]);
  return mark;
}

interface RowProps {
  entry: FeedEntry;
  now: number;
  styles: FeedStyles;
  /** Absent on a host without navigation. */
  onOpen?: (agentId: string) => void;
}

function RowBody({ entry, now, styles, opens }: RowProps & { opens: boolean }) {
  return (
    <>
      <View style={styles.cardIcon}>
        <Icon name={ICONS[entry.kind]} size={16} color={styles.kindColor[entry.kind]} />
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {entryTitle(entry)}
        </Text>
        <Text style={styles.cardMeta}>
          <Text style={styles.kindLabel[entry.kind]}>{KIND_LABEL[entry.kind]}</Text>
          {` · ${entryMeta(entry, now)}`}
        </Text>
        {entry.text === null ? null : (
          <Text style={styles.cardText} numberOfLines={2}>
            {entry.text}
          </Text>
        )}
      </View>
      {opens ? (
        <View style={styles.cardIcon}>
          <Icon name="ChevronRight" size={16} color={styles.iconColor} />
        </View>
      ) : null}
    </>
  );
}

function Row({ entry, now, styles, onOpen }: RowProps) {
  const { agentId } = entry;
  const open = useCallback(() => onOpen?.(agentId), [agentId, onOpen]);
  if (onOpen === undefined) {
    return (
      <View style={styles.card}>
        <RowBody entry={entry} now={now} styles={styles} opens={false} />
      </View>
    );
  }
  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={entryLabel(entry)}
      style={styles.card}
    >
      <RowBody entry={entry} now={now} styles={styles} opens />
    </Pressable>
  );
}

interface SectionProps extends Omit<RowProps, "entry"> {
  /** Absent when the list is one section: it needs no name. */
  title?: string;
  entries: readonly FeedEntry[];
}

function Section({ title, entries, ...row }: SectionProps) {
  if (entries.length === 0) return null;
  return (
    <View style={row.styles.section} accessibilityLabel={title}>
      {title === undefined ? null : (
        <Text accessibilityRole="header" style={row.styles.sectionTitle}>
          {title}
        </Text>
      )}
      {entries.map((entry) => (
        <Row key={entry.id} entry={entry} {...row} />
      ))}
    </View>
  );
}

interface EntriesProps extends Omit<RowProps, "entry"> {
  entries: readonly FeedEntry[];
  /** When the feed was last opened before this time. */
  seenAt: string | null;
}

// Split by when the feed was opened before this time, and not by the host's newer "seen": what
// was new stays under "New" while the screen is up.
function Entries({ entries, seenAt, ...row }: EntriesProps) {
  const fresh = useMemo(
    () => entries.filter((entry) => isNew(entry.at, seenAt)),
    [entries, seenAt],
  );
  const earlier = useMemo(
    () => entries.filter((entry) => !isNew(entry.at, seenAt)),
    [entries, seenAt],
  );
  return (
    <>
      <Section title="New" entries={fresh} {...row} />
      <Section title={fresh.length === 0 ? undefined : "Earlier"} entries={earlier} {...row} />
    </>
  );
}

function Body({ feed, ...row }: Omit<RowProps, "entry"> & { feed: LiveFeed }) {
  const { styles } = row;
  if (feed.subscription.status === "error") {
    return (
      <Text accessibilityRole="alert" style={styles.error}>
        Unable to load the feed: {feed.subscription.error.message}
      </Text>
    );
  }
  // Closed means the plugin's handler finished, and the hook does not subscribe again: without
  // this the rows would stay on screen and never change.
  if (feed.subscription.status === "closed") {
    return (
      <Text accessibilityRole="alert" style={styles.error}>
        Unable to keep the feed current: the host closed it. Reopen the feed.
      </Text>
    );
  }
  if (feed.opened === null) return <Text style={styles.muted}>Loading...</Text>;
  if (feed.state.entries.length === 0) return <Text style={styles.muted}>{EMPTY}</Text>;
  return <Entries entries={feed.state.entries} seenAt={feed.opened.seenAt} {...row} />;
}

export function FeedScreen({ theme, navigation }: PluginScreenProps) {
  const styles = useFeedStyles(theme);
  const feed = useFeed();
  const now = useNow();
  const markSeen = useSeen(feed);
  // Runs before the pressed row takes the press, and returns false so the row still gets it.
  const pressed = useCallback(() => {
    markSeen();
    return false;
  }, [markSeen]);
  const openAgent = navigation?.openAgent;
  const open = useCallback((agentId: string) => openAgent?.({ agentId }), [openAgent]);
  return (
    <View style={styles.screen} onStartShouldSetResponderCapture={pressed}>
      <ScrollView contentContainerStyle={styles.content}>
        <Body feed={feed} now={now} styles={styles} onOpen={openAgent ? open : undefined} />
      </ScrollView>
    </View>
  );
}
