import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Platform,
  Pressable,
  Text,
  View,
  type TextInputKeyPressEvent,
  type ViewStyle,
} from "react-native";
import { ScrollView, TextInput } from "@getpaseo/plugin/client/ui";
import { stateLabel } from "./agent-card.js";
import { contextPercent } from "./context-text.js";
import {
  LIST_TABS,
  NO_MATCH,
  SEARCH_LABEL,
  contextLevel,
  costText,
  filterRooms,
  rowLabel,
  secondLine,
  tabCounts,
  timeText,
  type ListTab,
} from "./list-text.js";
import {
  agentTitle,
  attentionReason,
  dotTone,
  type OfficeRoom,
  type OfficeRow,
} from "../shared/model.js";
import { PermissionActions } from "./permission-actions.js";
import { RoomBoard } from "./room-board.js";
import type { OfficeStyles } from "./styles.js";
import type { AgentActions } from "./use-agent-actions.js";
import { listenForSlash } from "./web-env.web.js";

const SEARCH_ID = "office-list-search";
const SECOND = 1000;
const MINUTE = 60_000;

/**
 * How often the shown rows' times change: every second while a turn's clock runs, every minute
 * while only resting agents show how long they have rested, never when no row shows a time.
 */
function clockInterval(rooms: readonly OfficeRoom[]): number | null {
  let interval: number | null = null;
  for (const room of rooms) {
    for (const { agent } of room.rows) {
      if (attentionReason(agent) !== null) continue;
      if (agent.status === "running") return SECOND;
      if (agent.status === "idle") interval = MINUTE;
    }
  }
  return interval;
}

/** The time now, read again every `intervalMs`; kept as it was while that is null. */
function useNow(intervalMs: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (intervalMs === null) return undefined;
    // A clock that starts after a quiet spell reads the time first, not a tick later.
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Lit is under a finger or a pointer. */
function rowStyle(styles: OfficeStyles, child: boolean, lit: boolean) {
  if (child) return lit ? styles.rowChildPressed : styles.rowChild;
  return lit ? styles.rowPressed : styles.row;
}

function wrapperStyle(styles: OfficeStyles, child: boolean, endsGroup: boolean) {
  if (!child) return styles.rowDivider;
  return endsGroup ? styles.rowGroupEnd : undefined;
}

interface AgentRowProps {
  row: OfficeRow;
  room: OfficeRoom;
  /** The last child of its parent. */
  endsGroup: boolean;
  styles: OfficeStyles;
  compact: boolean;
  now: number;
  actions: AgentActions;
  onSelect(agentId: string): void;
  onOpenSession: ((agentId: string) => void) | undefined;
}

/** The context's short bar, filled to its percent in its level's tone. */
function ContextBar({ percent, styles }: { percent: number; styles: OfficeStyles }) {
  const fill = useMemo(
    (): ViewStyle[] => [styles.listContextFill[contextLevel(percent)], { width: `${percent}%` }],
    [styles, percent],
  );
  return (
    <View style={styles.listContextTrack}>
      <View style={styles.listContextBase} />
      <View style={fill} />
    </View>
  );
}

/** A row's context, time and cost, each left out when it has nothing. */
function RowFacts({ row, now, styles }: { row: OfficeRow; now: number; styles: OfficeStyles }) {
  const percent = contextPercent(row.agent);
  const time = timeText(row, now);
  const cost = costText(row.agent.costUsd);
  if (percent === null && time === null && cost === null) return null;
  return (
    <View style={styles.listFacts}>
      {percent === null ? null : <ContextBar percent={percent} styles={styles} />}
      {percent === null ? null : <Text style={styles.listFact}>{percent}%</Text>}
      {time === null ? null : <Text style={styles.listFact}>{time}</Text>}
      {cost === null ? null : <Text style={styles.listFact}>{cost}</Text>}
    </View>
  );
}

function AgentRow({
  row,
  room,
  endsGroup,
  styles,
  compact,
  now,
  actions,
  onSelect,
  onOpenSession,
}: AgentRowProps) {
  const { agent } = row;
  const child = row.depth === 1;
  const press = useCallback(() => onSelect(agent.id), [agent.id, onSelect]);
  const openSession = useCallback(() => onOpenSession?.(agent.id), [agent.id, onOpenSession]);
  // The row styles itself and holds no other pressable: its requests sit beside it, not in it.
  const [hovered, setHovered] = useState(false);
  const hoverIn = useCallback(() => setHovered(true), []);
  const hoverOut = useCallback(() => setHovered(false), []);
  const [pressed, setPressed] = useState(false);
  const pressIn = useCallback(() => setPressed(true), []);
  const pressOut = useCallback(() => setPressed(false), []);
  const lit = pressed || hovered;
  const title = agentTitle(agent);
  const tone = dotTone(agent);
  const state = stateLabel(agent);
  return (
    <View style={wrapperStyle(styles, child, endsGroup)}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={rowLabel(row, state, now)}
        onPress={press}
        onPressIn={pressIn}
        onPressOut={pressOut}
        onHoverIn={hoverIn}
        onHoverOut={hoverOut}
        style={rowStyle(styles, child, lit)}
      >
        {lit ? <View style={styles.pressedFill} /> : null}
        <View style={styles.lead}>
          <View style={styles.dot[tone]} />
        </View>
        <View style={styles.rowBody}>
          <View style={styles.rowHeading}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {title}
            </Text>
            {/* Idle is the quiet state: its dot is enough, and the label would repeat down the list. */}
            {tone === "idle" ? null : <Text style={styles.rowState[tone]}>{state}</Text>}
          </View>
          <Text style={styles.rowMeta} numberOfLines={1}>
            {secondLine(agent, room)}
          </Text>
          {compact ? <RowFacts row={row} now={now} styles={styles} /> : null}
          {row.activity ? (
            <Text style={styles.rowActivity} numberOfLines={1}>
              {row.activity}
            </Text>
          ) : null}
        </View>
        {compact ? null : <RowFacts row={row} now={now} styles={styles} />}
      </Pressable>
      {agent.permissions.length > 0 ? (
        <View style={child ? styles.rowChildPermissions : styles.rowPermissions}>
          {agent.permissions.map((permission) => (
            <PermissionActions
              key={permission.id}
              agentId={agent.id}
              permission={permission}
              actions={actions}
              styles={styles}
              onOpenSession={onOpenSession ? openSession : undefined}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

interface RoomCardProps {
  room: OfficeRoom;
  styles: OfficeStyles;
  compact: boolean;
  now: number;
  actions: AgentActions;
  name(author: string): string;
  onSelectAgent(agentId: string): void;
  onOpenSession: ((agentId: string) => void) | undefined;
  onOpenBoard(roomId: string): void;
}

function RoomCard({
  room,
  styles,
  compact,
  now,
  actions,
  name,
  onSelectAgent,
  onOpenSession,
  onOpenBoard,
}: RoomCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {room.name}
        </Text>
        {room.subtitle ? (
          <Text style={styles.cardSubtitle} numberOfLines={1}>
            {room.subtitle}
          </Text>
        ) : null}
      </View>
      {room.rows.length === 0 ? <Text style={styles.empty}>No agents</Text> : null}
      {room.rows.map((row, index) => (
        <AgentRow
          key={row.agent.id}
          row={row}
          room={room}
          endsGroup={row.depth === 1 && room.rows[index + 1]?.depth !== 1}
          styles={styles}
          compact={compact}
          now={now}
          actions={actions}
          onSelect={onSelectAgent}
          onOpenSession={onOpenSession}
        />
      ))}
      <RoomBoard room={room} name={name} styles={styles} onOpenBoard={onOpenBoard} />
    </View>
  );
}

interface TabProps {
  tab: ListTab;
  label: string;
  count: number;
  selected: boolean;
  onChoose(tab: ListTab): void;
  styles: OfficeStyles;
}

/** One of the bar's tabs, drawn as the view switch's pills, with its count beside its label. */
function Tab({ tab, label, count, selected, onChoose, styles }: TabProps) {
  const press = useCallback(() => onChoose(tab), [onChoose, tab]);
  const [hovered, setHovered] = useState(false);
  const hoverIn = useCallback(() => setHovered(true), []);
  const hoverOut = useCallback(() => setHovered(false), []);
  const [pressed, setPressed] = useState(false);
  const pressIn = useCallback(() => setPressed(true), []);
  const pressOut = useCallback(() => setPressed(false), []);
  let fill = null;
  if (selected) fill = styles.segmentFill;
  else if (hovered || pressed) fill = styles.segmentHoverFill;
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={`${label} (${count})`}
      aria-selected={selected}
      onPress={press}
      onPressIn={pressIn}
      onPressOut={pressOut}
      onHoverIn={hoverIn}
      onHoverOut={hoverOut}
      style={styles.listTab}
    >
      {fill === null ? null : <View style={fill} />}
      <Text style={selected ? styles.segmentTextSelected : styles.segmentText}>{label}</Text>
      <Text style={styles.listTabCount}>{count}</Text>
    </Pressable>
  );
}

interface ListBarProps {
  counts: Record<ListTab, number>;
  tab: ListTab;
  onTab(tab: ListTab): void;
  query: string;
  onQuery(query: string): void;
  compact: boolean;
  styles: OfficeStyles;
}

/** The tabs and the search over the cards. On a phone the tabs scroll sideways over the search. */
function ListBar({ counts, tab, onTab, query, onQuery, compact, styles }: ListBarProps) {
  const clearOnEscape = useCallback(
    (event: TextInputKeyPressEvent) => {
      if (event.nativeEvent.key === "Escape") onQuery("");
    },
    [onQuery],
  );
  const tabs = (
    <View accessibilityRole="tablist" style={styles.listTabs}>
      {LIST_TABS.map(({ tab: each, label }) => (
        <Tab
          key={each}
          tab={each}
          label={label}
          count={counts[each]}
          selected={each === tab}
          onChoose={onTab}
          styles={styles}
        />
      ))}
    </View>
  );
  return (
    <View style={styles.listBar}>
      {compact ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.listTabScroll}>
          {tabs}
        </ScrollView>
      ) : (
        tabs
      )}
      <TextInput
        nativeID={SEARCH_ID}
        accessibilityLabel={SEARCH_LABEL}
        placeholder={SEARCH_LABEL}
        placeholderTextColor={styles.placeholderColor}
        value={query}
        onChangeText={onQuery}
        onKeyPress={clearOnEscape}
        style={styles.listSearch}
      />
    </View>
  );
}

export interface StructureViewProps {
  rooms: readonly OfficeRoom[];
  styles: OfficeStyles;
  /** The phone's layout: the bar stacks, and a row's context, time and cost go under its text. */
  compact: boolean;
  actions: AgentActions;
  /** How a post names its author, its claimer and the agent it is for. */
  name(author: string): string;
  onSelectAgent(agentId: string): void;
  /** Opens an agent's session from its row. Absent on a host that gives no navigation. */
  onOpenSession?(agentId: string): void;
  onOpenBoard(roomId: string): void;
}

/**
 * The office as cards: one per room, the lobby first (or the tab's own room), under a bar that
 * filters them by tab and by search.
 */
export function StructureView({
  rooms,
  styles,
  compact,
  actions,
  name,
  onSelectAgent,
  onOpenSession,
  onOpenBoard,
}: StructureViewProps) {
  const [tab, setTab] = useState<ListTab>("all");
  const [query, setQuery] = useState("");
  const counts = useMemo(() => tabCounts(rooms.flatMap((room) => room.rows)), [rooms]);
  const shown = useMemo(() => filterRooms(rooms, tab, query), [rooms, tab, query]);
  const now = useNow(clockInterval(shown));
  useEffect(() => (Platform.OS === "web" ? listenForSlash(SEARCH_ID) : undefined), []);
  // An office without agents keeps its rooms' own "No agents"; a filter that finds none says so.
  const found = counts.all === 0 || shown.some((room) => room.rows.length > 0);
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <ListBar
        counts={counts}
        tab={tab}
        onTab={setTab}
        query={query}
        onQuery={setQuery}
        compact={compact}
        styles={styles}
      />
      {found ? null : <Text style={styles.muted}>{NO_MATCH}</Text>}
      {(counts.all === 0 ? rooms : shown).map((room) => (
        <RoomCard
          key={room.id}
          room={room}
          styles={styles}
          compact={compact}
          now={now}
          actions={actions}
          name={name}
          onSelectAgent={onSelectAgent}
          onOpenSession={onOpenSession}
          onOpenBoard={onOpenBoard}
        />
      ))}
    </ScrollView>
  );
}
