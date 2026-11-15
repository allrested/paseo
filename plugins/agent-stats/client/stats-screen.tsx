import { useCallback, useMemo, useState } from "react";
import {
  Pressable,
  Text,
  View,
  type DimensionValue,
  type PressableStateCallbackType,
  type ViewStyle,
} from "react-native";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { Icon, ScrollView } from "@getpaseo/plugin/client/ui";
import { RANGES, type Range } from "../shared/contracts.js";
import {
  LOCAL,
  scaleFor,
  summarize,
  type DayCount,
  type Summary,
  type WorkspaceCount,
} from "./aggregate.js";
import { hasTouchScreen } from "./device.js";
import {
  axisDays,
  countLine,
  counted,
  dayLabel,
  dayReadout,
  emptyLabel,
  headline,
  rangeLabel,
  sinceNote,
  tickLabel,
  workspaceLabel,
} from "./format.js";
import { useStatsStyles, type StatsStyles } from "./styles.js";
import { useStats, type LiveStats } from "./use-stats.js";

const percent = (part: number, whole: number): DimensionValue =>
  `${whole === 0 ? 0 : (part / whole) * 100}%`;

interface RangeButtonProps {
  days: Range;
  chosen: boolean;
  styles: StatsStyles;
  onChoose(days: Range): void;
}

function RangeButton({ days, chosen, styles, onChoose }: RangeButtonProps) {
  const press = useCallback(() => onChoose(days), [days, onChoose]);
  return (
    <Pressable
      onPress={press}
      accessibilityRole="button"
      accessibilityLabel={`Last ${rangeLabel(days)}`}
      aria-pressed={chosen}
      style={chosen ? styles.rangeChosen : styles.range}
    >
      <Text style={chosen ? styles.rangeTextChosen : styles.rangeText}>{rangeLabel(days)}</Text>
    </Pressable>
  );
}

interface TileProps {
  label: string;
  value: string;
  styles: StatsStyles;
}

function Tile({ label, value, styles }: TileProps) {
  return (
    <View style={styles.tile} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileValue}>{value}</Text>
    </View>
  );
}

interface DayColumnProps {
  day: string;
  index: number;
  style: ViewStyle;
  column: ViewStyle;
  onPick(index: number): void;
  onLeave(index: number): void;
}

function DayColumn({ day, index, style, column, onPick, onLeave }: DayColumnProps) {
  const pick = useCallback(() => onPick(index), [index, onPick]);
  const leave = useCallback(() => onLeave(index), [index, onLeave]);
  return (
    // The whole slot takes the pointer and the finger, not only the bar: a thin bar is a small
    // target, and a day without one has none.
    <Pressable
      onPress={pick}
      onHoverIn={pick}
      onHoverOut={leave}
      focusable={false}
      accessible={false}
      testID={`stats-day-${day}`}
      style={column}
    >
      <View style={style} />
    </Pressable>
  );
}

interface DaysProps {
  days: readonly DayCount[];
  styles: StatsStyles;
}

function DayChart({ days, styles }: DaysProps) {
  const [picked, setPicked] = useState<number | null>(null);
  const onLeave = useCallback(
    (index: number) => setPicked((now) => (now === index ? null : now)),
    [],
  );
  const scale = useMemo(
    () => scaleFor(days.reduce((most, day) => Math.max(most, day.workMs), 0)),
    [days],
  );
  const lines = useMemo(
    () => scale.ticks.map((tick) => ({ ...styles.gridLine, bottom: percent(tick, scale.top) })),
    [scale, styles],
  );
  const bars = useMemo(
    () =>
      days.map((day, index): ViewStyle => {
        const bar = index === picked ? styles.barPicked : styles.bar;
        // A day nothing happened on has no bar, not the thinnest one.
        return day.workMs === 0
          ? { ...bar, minHeight: 0, height: 0 }
          : { ...bar, height: percent(day.workMs, scale.top) };
      }),
    [days, picked, scale, styles],
  );
  const labels = useMemo(() => axisDays(days), [days]);
  const week = labels.length === days.length;
  const shown = picked === null ? null : days[picked];
  return (
    <>
      <Text accessibilityLiveRegion="polite" style={styles.readout}>
        {shown ? dayReadout(shown) : "Pick a day for its numbers"}
      </Text>
      {/* For a pointer and a finger. A screen reader and a keyboard have the table. */}
      <View
        style={styles.chart}
        aria-hidden
        importantForAccessibility="no-hide-descendants"
        testID="stats-chart"
      >
        <View style={styles.scale}>
          {scale.ticks.toReversed().map((tick) => (
            <Text key={tick} style={styles.scaleLabel}>
              {tickLabel(tick)}
            </Text>
          ))}
        </View>
        <View style={styles.plotColumn}>
          <View style={styles.plot}>
            {lines.map((line, index) => (
              <View key={scale.ticks[index]} style={line} />
            ))}
            <View style={styles.columns}>
              {days.map((day, index) => (
                <DayColumn
                  key={day.day}
                  day={day.day}
                  index={index}
                  style={bars[index]}
                  column={styles.column}
                  onPick={setPicked}
                  onLeave={onLeave}
                />
              ))}
            </View>
          </View>
          <View style={styles.axis}>
            {labels.map((label, index) => (
              // A week's names repeat in no range, and a range's dates are distinct.
              // oxlint-disable-next-line react/no-array-index-key
              <Text key={index} style={week ? styles.axisSlot : styles.axisLabel}>
                {label}
              </Text>
            ))}
          </View>
        </View>
      </View>
    </>
  );
}

/** The days something happened on, the newest first, as lines of text. */
function DayTable({ days, styles }: DaysProps) {
  const busy = useMemo(
    () => days.filter((day) => day.turns > 0 || day.workMs > 0).toReversed(),
    [days],
  );
  return (
    <View style={styles.rows} testID="stats-table">
      {busy.map((day) => (
        <View key={day.day} style={styles.row}>
          <View style={styles.rowHead}>
            <Text style={styles.rowName}>{dayLabel(day.day)}</Text>
            <Text style={styles.rowFigure}>{countLine(day)}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function Days({ days, styles }: DaysProps) {
  const [table, setTable] = useState(false);
  const toggle = useCallback(() => setTable((now) => !now), []);
  const toggleStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => (pressed ? styles.togglePressed : styles.toggle),
    [styles],
  );
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          Agent time by day
        </Text>
        <Pressable
          onPress={toggle}
          accessibilityRole="button"
          accessibilityLabel="Show the days as a table"
          aria-pressed={table}
          style={toggleStyle}
        >
          <Icon name={table ? "ChartColumn" : "Table"} size={16} color={styles.iconColor} />
        </Pressable>
      </View>
      {table ? (
        <DayTable days={days} styles={styles} />
      ) : (
        // A new range is a new chart: the day picked in the last one is not in it.
        <DayChart key={days.length} days={days} styles={styles} />
      )}
    </View>
  );
}

interface WorkspaceRowProps {
  workspace: WorkspaceCount;
  /** The most time any workspace has: the full length of a bar. */
  most: number;
  styles: StatsStyles;
  /** Absent on a host without navigation. */
  onOpen?: (workspaceId: string) => void;
}

function WorkspaceRow({ workspace, most, styles, onOpen }: WorkspaceRowProps) {
  const { id } = workspace;
  const open = useCallback(() => onOpen?.(id), [id, onOpen]);
  const fill = useMemo(
    () => ({ ...styles.fill, width: percent(workspace.workMs, most) }),
    [styles, workspace.workMs, most],
  );
  const rowStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => (pressed ? styles.rowPressed : styles.row),
    [styles],
  );
  const body = (
    <>
      <View style={styles.rowHead}>
        <Text numberOfLines={1} style={styles.rowName}>
          {workspace.name}
        </Text>
        <Text style={styles.rowFigure}>{countLine(workspace)}</Text>
      </View>
      <View style={styles.track}>
        <View style={fill} />
      </View>
    </>
  );
  if (!workspace.open || onOpen === undefined) {
    return (
      <View style={styles.row} accessible accessibilityLabel={workspaceLabel(workspace, false)}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={workspaceLabel(workspace, true)}
      style={rowStyle}
    >
      {body}
    </Pressable>
  );
}

interface LoadedProps {
  summary: Summary;
  range: Range;
  /** The day the host began to count, when that is inside the range. */
  since: string | null;
  styles: StatsStyles;
  onOpen?: (workspaceId: string) => void;
}

function Loaded({ summary, range, since, styles, onOpen }: LoadedProps) {
  const { total, days, workspaces } = summary;
  const note = since === null ? null : <Text style={styles.muted}>{sinceNote(since)}</Text>;
  if (total.turns === 0 && total.workMs === 0) {
    return (
      <>
        <Text style={styles.muted}>{emptyLabel(range)}</Text>
        {note}
      </>
    );
  }
  const most = workspaces[0]?.workMs ?? 0;
  return (
    <>
      <View style={styles.tiles}>
        <Tile label="Turns" value={counted(total.turns)} styles={styles} />
        <Tile label="Agent time" value={headline(total.workMs)} styles={styles} />
        <Tile label="Failed turns" value={counted(total.failed)} styles={styles} />
      </View>
      {note}
      <Days days={days} styles={styles} />
      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          By workspace
        </Text>
        <View style={styles.rows}>
          {workspaces.map((workspace) => (
            <WorkspaceRow
              key={workspace.id}
              workspace={workspace}
              most={most}
              styles={styles}
              onOpen={onOpen}
            />
          ))}
        </View>
      </View>
    </>
  );
}

interface BodyProps {
  live: LiveStats;
  range: Range;
  styles: StatsStyles;
  onOpen?: (workspaceId: string) => void;
}

function Body({ live, range, styles, onOpen }: BodyProps) {
  const ready = live.status === "ready" ? live : null;
  const summary = useMemo(
    () => (ready ? summarize(ready.stats, range, ready.readAt) : null),
    [ready, range],
  );
  if (live.status === "loading") return <Text style={styles.muted}>Loading...</Text>;
  if (live.status === "error" || ready === null || summary === null) {
    return (
      <Text accessibilityRole="alert" style={styles.error}>
        Unable to load the stats: {live.status === "error" ? live.message : "no answer"}
      </Text>
    );
  }
  const began = Date.parse(ready.stats.countingSince);
  const since = began > LOCAL.dayStart(ready.readAt, range - 1) ? LOCAL.dayOf(began) : null;
  return <Loaded summary={summary} range={range} since={since} styles={styles} onOpen={onOpen} />;
}

export function StatsScreen({ theme, layout, navigation }: PluginScreenProps) {
  // Asked once for the screen's life, like the app: a mouse plugged into a tablet does not
  // shrink its controls.
  const touchScreen = useMemo(() => hasTouchScreen(layout.platform), [layout.platform]);
  const styles = useStatsStyles(theme, layout.compact || touchScreen);
  const live = useStats();
  const [range, setRange] = useState<Range>(RANGES[0]);
  const openWorkspace = navigation?.openWorkspace;
  const open = useCallback(
    (workspaceId: string) => openWorkspace?.({ workspaceId }),
    [openWorkspace],
  );
  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.ranges}>
          {RANGES.map((days) => (
            <RangeButton
              key={days}
              days={days}
              chosen={days === range}
              styles={styles}
              onChoose={setRange}
            />
          ))}
        </View>
        <Body live={live} range={range} styles={styles} onOpen={openWorkspace ? open : undefined} />
      </ScrollView>
    </View>
  );
}
