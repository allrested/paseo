import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { Icon, ScrollView, TextInput } from "@getpaseo/plugin/client/ui";
import {
  markRpc,
  seenRpc,
  type FeedEntry,
  type FeedKind,
  type RunningAgent,
} from "../shared/contracts.js";
import { isMarked, isNew, newCount } from "../shared/feed.js";
import { hasTouchScreen } from "./device.js";
import {
  KIND_LABEL,
  RUNNING,
  agentMatches,
  entryLabel,
  entryMatches,
  entryMeta,
  entryTitle,
  filterWords,
  markLabel,
  runningLabel,
  runningMeta,
} from "./format.js";
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

interface Shared {
  now: number;
  styles: FeedStyles;
  /** Absent on a host without navigation. */
  onOpen?: (agentId: string) => void;
}

interface RowProps extends Shared {
  entry: FeedEntry;
  /** The entry is kept unread. */
  marked: boolean;
  onMark(id: string, unread: boolean): void;
}

function RowBody({
  entry,
  now,
  styles,
  opens,
}: Pick<RowProps, "entry" | "now" | "styles"> & {
  opens: boolean;
}) {
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

function Row({ entry, marked, now, styles, onOpen, onMark }: RowProps) {
  const { agentId, id } = entry;
  // Opening an entry's agent reads the entry.
  const open = useCallback(() => {
    if (marked) onMark(id, false);
    onOpen?.(agentId);
  }, [agentId, id, marked, onMark, onOpen]);
  const toggle = useCallback(() => onMark(id, !marked), [id, marked, onMark]);
  const markStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => (pressed ? styles.markPressed : styles.mark),
    [styles],
  );
  return (
    // The mark is beside the part that opens the agent, not inside it: a button holds no button.
    <View style={styles.card}>
      {onOpen === undefined ? (
        <View style={styles.cardMain}>
          <RowBody entry={entry} now={now} styles={styles} opens={false} />
        </View>
      ) : (
        <Pressable
          onPress={open}
          accessibilityRole="button"
          accessibilityLabel={entryLabel(entry)}
          style={styles.cardMain}
        >
          <RowBody entry={entry} now={now} styles={styles} opens />
        </Pressable>
      )}
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityLabel={markLabel(entry, marked)}
        aria-pressed={marked}
        style={markStyle}
      >
        <Icon
          name={marked ? "Mail" : "MailOpen"}
          size={16}
          color={marked ? styles.markedColor : styles.iconColor}
        />
      </Pressable>
    </View>
  );
}

interface SectionProps extends Omit<RowProps, "entry" | "marked"> {
  /** Absent when the list is one section: it needs no name. */
  title?: string;
  entries: readonly FeedEntry[];
  /** The ids kept unread. */
  unread: readonly string[];
}

function Section({ title, entries, unread, ...row }: SectionProps) {
  if (entries.length === 0) return null;
  return (
    <View style={row.styles.section} accessibilityLabel={title}>
      {title === undefined ? null : (
        <Text accessibilityRole="header" style={row.styles.sectionTitle}>
          {title}
        </Text>
      )}
      {entries.map((entry) => (
        <Row key={entry.id} entry={entry} marked={unread.includes(entry.id)} {...row} />
      ))}
    </View>
  );
}

interface RunningRowProps extends Shared {
  agent: RunningAgent;
}

function RunningRow({ agent, now, styles, onOpen }: RunningRowProps) {
  const { agentId } = agent;
  const open = useCallback(() => onOpen?.(agentId), [agentId, onOpen]);
  const body = (
    <>
      <View style={styles.cardIcon}>
        <Icon name="Activity" size={16} color={styles.runningColor} />
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {entryTitle(agent)}
        </Text>
        <Text style={styles.cardMeta}>
          <Text style={styles.runningLabel}>{RUNNING}</Text>
          {` · ${runningMeta(agent, now)}`}
        </Text>
      </View>
      {onOpen === undefined ? null : (
        <View style={styles.cardIcon}>
          <Icon name="ChevronRight" size={16} color={styles.iconColor} />
        </View>
      )}
    </>
  );
  if (onOpen === undefined) return <View style={styles.card}>{body}</View>;
  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={runningLabel(agent)}
      style={styles.card}
    >
      {body}
    </Pressable>
  );
}

function Running({ agents, ...row }: Shared & { agents: readonly RunningAgent[] }) {
  if (agents.length === 0) return null;
  return (
    <View style={row.styles.section} accessibilityLabel={RUNNING}>
      <Text accessibilityRole="header" style={row.styles.sectionTitle}>
        {RUNNING}
      </Text>
      {agents.map((agent) => (
        <RunningRow key={agent.agentId} agent={agent} {...row} />
      ))}
    </View>
  );
}

const NO_IDS: readonly string[] = [];
const NONE_RUNNING: readonly RunningAgent[] = [];

interface LoadedProps extends Shared {
  feed: LiveFeed;
  /** When the feed was last opened before this time. */
  seenAt: string | null;
}

function Loaded({ feed, seenAt, ...row }: LoadedProps) {
  const { styles } = row;
  const mark = useRpc(markRpc);
  // A mark that fails changes nothing on the host, and the row stays as it is.
  const onMark = useCallback(
    (id: string, unread: boolean) => void mark({ id, unread }).catch(() => undefined),
    [mark],
  );
  const [text, setText] = useState("");
  const words = useMemo(() => filterWords(text), [text]);
  const { entries } = feed.state;
  // The host says which agents are in a turn: a screen has no view of the app's agents.
  const everyRunning = feed.state.running ?? NONE_RUNNING;
  const running = useMemo(
    () => everyRunning.filter((agent) => agentMatches(agent, words)),
    [everyRunning, words],
  );
  const unread = feed.state.unread ?? NO_IDS;
  const shown = useMemo(
    () => entries.filter((entry) => entryMatches(entry, words)),
    [entries, words],
  );
  // Split by when the feed was opened before this time, and not by the host's newer "seen": what
  // was new stays under "Unread" while the screen is up. A marked entry is unread whenever.
  const fresh = useMemo(
    () => shown.filter((entry) => isNew(entry.at, seenAt) || isMarked(feed.state, entry.id)),
    [shown, seenAt, feed.state],
  );
  const earlier = useMemo(() => shown.filter((entry) => !fresh.includes(entry)), [shown, fresh]);
  if (entries.length === 0 && everyRunning.length === 0) {
    return <Text style={styles.muted}>{EMPTY}</Text>;
  }
  const named = fresh.length > 0 || running.length > 0;
  return (
    <>
      <TextInput
        accessibilityLabel="Filter the feed"
        value={text}
        onChangeText={setText}
        placeholder="Filter by agent, folder or words"
        placeholderTextColor={styles.placeholderColor}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.filter}
      />
      <Running agents={running} {...row} />
      <Section title="Unread" entries={fresh} unread={unread} onMark={onMark} {...row} />
      <Section
        title={named ? "Earlier" : undefined}
        entries={earlier}
        unread={unread}
        onMark={onMark}
        {...row}
      />
      {shown.length + running.length === 0 ? (
        <Text style={styles.muted}>{`Nothing matches "${text.trim()}"`}</Text>
      ) : null}
    </>
  );
}

function Body({ feed, ...row }: Shared & { feed: LiveFeed }) {
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
  return <Loaded feed={feed} seenAt={feed.opened.seenAt} {...row} />;
}

export function FeedScreen({ theme, layout, navigation }: PluginScreenProps) {
  // Asked once for the screen's life, like the app: a mouse plugged into a tablet does not
  // shrink its controls.
  const touchScreen = useMemo(() => hasTouchScreen(layout.platform), [layout.platform]);
  const styles = useFeedStyles(theme, layout.compact || touchScreen);
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
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Body feed={feed} now={now} styles={styles} onOpen={openAgent ? open : undefined} />
      </ScrollView>
    </View>
  );
}
