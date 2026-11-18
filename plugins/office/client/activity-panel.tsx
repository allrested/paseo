import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { Pressable, Text, View } from "react-native";
import { ScrollView } from "@getpaseo/plugin/client/ui";
import type { OfficeAgent } from "../shared/contracts.js";
import { dotTone, type DotTone } from "../shared/model.js";
import { ActionButton } from "./action-button.js";
import {
  feedCards,
  feedStore,
  type FeedCard,
  type FeedChip,
  type FeedTab,
} from "./activity-feed.js";
import { FEED_EMPTY, FEED_NO_MATCH } from "./activity-feed-text.js";
import type { ColumnPanelProps, OfficeLink } from "./office-link.js";
import { problemText } from "./office-surface.js";
import type { OfficeStyles } from "./styles.js";
import type { OfficeState } from "./use-office.js";

const CHIPS: readonly { chip: FeedChip; label: string }[] = [
  { chip: "cmd", label: "Commands" },
  { chip: "edit", label: "Edits" },
  { chip: "read", label: "Reads" },
  { chip: "web", label: "Web" },
  { chip: "agent", label: "Agents" },
];

const NO_CHIPS: ReadonlySet<FeedChip> = new Set();

/** A card's time: the clock on this device, 24-hour. */
function clock(at: number): string {
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

interface PillProps<Value extends string> {
  value: Value;
  label: string;
  /** What a screen reader calls it, when it says more than the label (a count). */
  name?: string;
  count?: number;
  on: boolean;
  /** A chip is a toggle and says it is pressed; a tab says it is the chosen one. */
  toggle: boolean;
  onPress(value: Value): void;
  styles: OfficeStyles;
}

/** A tab or a chip: the view switch's pill. */
export function Pill<Value extends string>({
  value,
  label,
  name,
  count,
  on,
  toggle,
  onPress,
  styles,
}: PillProps<Value>) {
  const press = useCallback(() => onPress(value), [onPress, value]);
  const [hovered, setHovered] = useState(false);
  const hoverIn = useCallback(() => setHovered(true), []);
  const hoverOut = useCallback(() => setHovered(false), []);
  const [pressed, setPressed] = useState(false);
  const pressIn = useCallback(() => setPressed(true), []);
  const pressOut = useCallback(() => setPressed(false), []);
  let fill = null;
  if (on) fill = styles.segmentFill;
  else if (hovered || pressed) fill = styles.segmentHoverFill;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name ?? label}
      aria-pressed={toggle ? on : undefined}
      aria-selected={toggle ? undefined : on}
      onPress={press}
      onPressIn={pressIn}
      onPressOut={pressOut}
      onHoverIn={hoverIn}
      onHoverOut={hoverOut}
      style={styles.segment}
    >
      {fill === null ? null : <View style={fill} />}
      <Text style={on ? styles.segmentTextSelected : styles.segmentText}>
        {label}
        {count === undefined ? null : <Text style={styles.panelCount}> {count}</Text>}
      </Text>
    </Pressable>
  );
}

interface CardRowProps {
  card: FeedCard;
  /** The card's agent as the office has it now; absent once it has left. */
  agent: OfficeAgent | undefined;
  link: OfficeLink;
  styles: OfficeStyles;
}

function CardRow({ card, agent, link, styles }: CardRowProps) {
  const { agentId } = card;
  const press = useCallback(() => link.select(agentId), [agentId, link]);
  const openSession = useCallback(() => link.openSession(agentId), [agentId, link]);
  const [hovered, setHovered] = useState(false);
  const hoverIn = useCallback(() => setHovered(true), []);
  const hoverOut = useCallback(() => setHovered(false), []);
  const [pressed, setPressed] = useState(false);
  const pressIn = useCallback(() => setPressed(true), []);
  const pressOut = useCallback(() => setPressed(false), []);
  const tone: DotTone = agent === undefined ? "idle" : dotTone(agent);
  const time = clock(card.at);
  // Open session sits under the card's pressable, not in it, so its press is its own.
  return (
    <View style={styles.rowDivider}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${card.title}, ${time}`}
        onPress={press}
        onPressIn={pressIn}
        onPressOut={pressOut}
        onHoverIn={hoverIn}
        onHoverOut={hoverOut}
        style={styles.row}
      >
        {pressed || hovered ? <View style={styles.pressedFill} /> : null}
        <View style={styles.lead}>
          <View style={styles.dot[tone]} />
        </View>
        <View style={styles.rowBody}>
          <View style={styles.rowHeading}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {card.title}
            </Text>
            {agent?.status === "running" ? (
              <Text style={styles.rowState.running}>Working</Text>
            ) : null}
            <Text style={styles.panelTime}>{time}</Text>
          </View>
          {card.lines.map((line, index) => (
            // A card's lines repeat ("Editing" twice), so their place is their key.
            // oxlint-disable-next-line react/no-array-index-key
            <Text key={index} style={styles.rowActivity} numberOfLines={2}>
              {line}
            </Text>
          ))}
          {card.more > 0 ? <Text style={styles.rowMeta}>+{card.more} more</Text> : null}
        </View>
      </Pressable>
      {card.alert ? (
        <View style={styles.panelActions}>
          <ActionButton
            label="Open session"
            pendingLabel="Opening..."
            onPress={openSession}
            styles={styles}
          />
        </View>
      ) : null}
    </View>
  );
}

/** The office's own words for a state that cannot load, as its surface shows them. */
export function loadProblem(subscription: OfficeState["subscription"]): string | null {
  if (subscription.status === "error") {
    return problemText("Unable to load the office", subscription.error.message);
  }
  if (subscription.status === "closed") {
    return "Unable to show live agents: the host closed the office. Reopen it.";
  }
  return null;
}

/**
 * The Activity tab of the office's column, fed by the surface's subscription: the feed of what
 * the agents did, filtered by its tabs and chips.
 */
export function ActivityPanel({ office, styles, link }: ColumnPanelProps) {
  const { state, subscription } = office;
  const events = useSyncExternalStore(feedStore.subscribe, feedStore.getSnapshot);
  const [tab, setTab] = useState<FeedTab>("all");
  const [chips, setChips] = useState<ReadonlySet<FeedChip>>(NO_CHIPS);
  const cards = useMemo(() => feedCards(events, tab, chips), [events, tab, chips]);
  const needsYou = useMemo(() => feedCards(events, "attention", NO_CHIPS).length, [events]);
  const agents = useMemo(
    () => new Map(state.agents.map((agent) => [agent.id, agent])),
    [state.agents],
  );
  const toggle = useCallback((chip: FeedChip) => {
    setChips((current) => {
      const next = new Set(current);
      if (!next.delete(chip)) next.add(chip);
      return next;
    });
  }, []);
  const problem = loadProblem(subscription);
  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.panelFeed}>
        <View style={styles.panelTop}>
          {subscription.status === "live" ? (
            <View style={styles.panelLive}>
              <View style={styles.dot.running} />
              <Text style={styles.panelLiveText}>Live</Text>
            </View>
          ) : null}
          <View role="group" aria-label="Feed" style={styles.segments}>
            <Pill<FeedTab>
              value="all"
              label="All"
              on={tab === "all"}
              toggle={false}
              onPress={setTab}
              styles={styles}
            />
            <Pill<FeedTab>
              value="attention"
              label="Needs you"
              name={`Needs you, ${needsYou}`}
              count={needsYou}
              on={tab === "attention"}
              toggle={false}
              onPress={setTab}
              styles={styles}
            />
          </View>
          <View role="group" aria-label="Kinds" style={styles.panelChips}>
            {CHIPS.map(({ chip, label }) => (
              <Pill
                key={chip}
                label={label}
                on={chips.has(chip)}
                toggle
                value={chip}
                onPress={toggle}
                styles={styles}
              />
            ))}
          </View>
        </View>
        {problem === null ? null : (
          <View style={styles.bannerSlot}>
            <View style={styles.banner}>
              <Text accessibilityRole="alert" style={styles.bannerText}>
                {problem}
              </Text>
            </View>
          </View>
        )}
        {events.length === 0 ? <Text style={styles.sceneStatus}>{FEED_EMPTY}</Text> : null}
        {events.length > 0 && cards.length === 0 ? (
          <Text style={styles.sceneStatus}>{FEED_NO_MATCH}</Text>
        ) : null}
        {cards.map((card, index) => (
          <CardRow
            // A card has no id, and two alerts of one agent can share a moment and a text.
            // oxlint-disable-next-line react/no-array-index-key
            key={`${card.agentId}:${card.at}:${index}`}
            card={card}
            agent={agents.get(card.agentId)}
            link={link}
            styles={styles}
          />
        ))}
      </ScrollView>
    </View>
  );
}
