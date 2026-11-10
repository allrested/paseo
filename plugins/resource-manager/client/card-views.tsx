import { useCallback, useMemo, type ReactNode } from "react";
import { Pressable, Text, View, type ViewStyle } from "react-native";
import { Icon, SettingsCard } from "@getpaseo/plugin/client/ui";
import type {
  CardStatus,
  CardSummary,
  DetailBlock,
  Meter,
  OpenSet,
  TrendHistory,
  TrendLine,
  TrendSample,
} from "./cards.js";
import { TREND_HEIGHT, type ScreenStyles } from "./styles.js";

/** Open cards and trend readings. The screen owns both, so they outlive a tab switch. */
export interface CardsState {
  open: OpenSet;
  trend: TrendHistory;
  toggle(id: string): void;
  setAll(ids: readonly string[], value: boolean): void;
  record(samples: readonly TrendSample[]): void;
}

// Each status has its own shape, so it reads without colour.
const STATUS_ICONS: Record<CardStatus, string> = {
  ok: "CircleCheck",
  warning: "TriangleAlert",
  critical: "OctagonAlert",
  error: "CircleX",
  waiting: "CircleDashed",
};

interface MeterViewProps {
  meter: Meter;
  styles: ScreenStyles;
}

function MeterView({ meter, styles }: MeterViewProps) {
  const { fraction, level } = meter;
  const fill = useMemo(
    (): ViewStyle[] => [
      styles.meterFill[level],
      { width: `${Math.round((fraction ?? 0) * 100)}%` },
    ],
    [styles, level, fraction],
  );
  return (
    <View style={styles.meter}>
      <Text numberOfLines={1} style={styles.meterLabel}>
        {meter.label}
      </Text>
      <Text numberOfLines={1} style={styles.meterValue}>
        {meter.value}
      </Text>
      {/* The track stays without a reading, so the three columns keep one baseline. */}
      <View style={styles.meterTrack}>{fraction === null ? null : <View style={fill} />}</View>
    </View>
  );
}

interface ResourceCardProps {
  /** The card's key among the open cards. */
  id: string;
  title: string;
  /** The muted line under the title. */
  meta: string;
  /** Status, note and meters. Null for a card that only groups rows. */
  summary: CardSummary | null;
  /** False when there is nothing more to show; the card then has no Details control. */
  expandable: boolean;
  open: boolean;
  onToggle(id: string): void;
  styles: ScreenStyles;
  /** The details. Each child gets a divider, so pass the blocks or rows themselves. */
  children?: ReactNode;
}

/**
 * A summary that opens on a tap. The whole summary is the control, and it says "Details" or
 * "Hide" on every platform: nothing here depends on hover.
 */
export function ResourceCard({
  id,
  title,
  meta,
  summary,
  expandable,
  open,
  onToggle,
  styles,
  children,
}: ResourceCardProps) {
  const press = useCallback(() => onToggle(id), [id, onToggle]);
  const state = useMemo(() => ({ expanded: open }), [open]);
  const shown = expandable && open;
  return (
    <SettingsCard>
      <Pressable
        accessibilityRole="button"
        accessibilityState={state}
        disabled={!expandable}
        onPress={press}
        style={styles.cardHeader}
      >
        <View style={styles.cardTitleRow}>
          {summary === null ? null : (
            <Icon
              name={STATUS_ICONS[summary.status]}
              size={14}
              color={styles.statusColor[summary.status]}
            />
          )}
          <Text numberOfLines={1} style={styles.cardTitle}>
            {title}
          </Text>
          {summary === null ? null : (
            <Text style={styles.statusText[summary.status]}>{summary.label}</Text>
          )}
        </View>
        <View style={styles.cardMetaRow}>
          <Text numberOfLines={1} style={styles.cardMeta}>
            {meta}
          </Text>
          {expandable ? (
            <View style={styles.detailsHint}>
              <Text style={styles.detailsHintText}>{open ? "Hide" : "Details"}</Text>
              <Icon
                name={open ? "ChevronDown" : "ChevronRight"}
                size={14}
                color={styles.chevronColor}
              />
            </View>
          ) : null}
        </View>
        {summary === null || summary.note === null ? null : (
          // One line while closed. A card with nothing to open shows the whole note.
          <Text
            accessibilityRole={summary.status === "error" ? "alert" : undefined}
            numberOfLines={expandable && !open ? 1 : undefined}
            style={styles.statusText[summary.status]}
          >
            {summary.note}
          </Text>
        )}
        {summary === null || summary.meters.length === 0 ? null : (
          <View style={styles.meters}>
            {summary.meters.map((meter) => (
              <MeterView key={meter.key} meter={meter} styles={styles} />
            ))}
          </View>
        )}
      </Pressable>
      {shown ? children : null}
    </SettingsCard>
  );
}

interface DetailBlockViewProps {
  block: DetailBlock;
  styles: ScreenStyles;
}

export function DetailBlockView({ block, styles }: DetailBlockViewProps) {
  return (
    <View style={styles.block}>
      <Text style={styles.blockTitle}>{block.title}</Text>
      {block.empty === null ? null : <Text style={styles.detailValue}>{block.empty}</Text>}
      {block.rows.map((row) => (
        <View key={row.key} style={styles.detailRow}>
          <Text style={styles.detailLabel}>{row.label}</Text>
          <Text style={styles.detailValue}>{row.value}</Text>
        </View>
      ))}
    </View>
  );
}

interface TrendBarProps {
  bar: number;
  styles: ScreenStyles;
}

function TrendBar({ bar, styles }: TrendBarProps) {
  const style = useMemo(
    (): ViewStyle[] => [styles.trendBar, { height: Math.max(1, Math.round(bar * TREND_HEIGHT)) }],
    [styles, bar],
  );
  return <View style={style} />;
}

interface TrendLineViewProps {
  line: TrendLine;
  styles: ScreenStyles;
}

function TrendLineView({ line, styles }: TrendLineViewProps) {
  return (
    <View style={styles.trendRow}>
      <Text style={styles.trendLabel}>{line.label}</Text>
      <View style={styles.trendBars}>
        {line.bars.map((bar) => (
          <TrendBar key={bar.at} bar={bar.height} styles={styles} />
        ))}
      </View>
      <Text numberOfLines={1} style={styles.trendRange}>
        {line.range}
      </Text>
    </View>
  );
}

interface TrendBlockProps {
  lines: TrendLine[];
  styles: ScreenStyles;
}

/** Bars from plain views: the plugin UI kit has no chart, and this needs no dependency. */
export function TrendBlock({ lines, styles }: TrendBlockProps) {
  return (
    <View style={styles.block}>
      <Text style={styles.blockTitle}>Trend since this screen opened</Text>
      {lines.length === 0 ? (
        <Text style={styles.detailValue}>Shows after the next reading</Text>
      ) : null}
      {lines.map((line) => (
        <TrendLineView key={line.key} line={line} styles={styles} />
      ))}
    </View>
  );
}
