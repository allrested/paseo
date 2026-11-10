import { useMemo } from "react";
import type { TextStyle, ViewStyle } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import type { CardStatus, Level } from "./cards.js";

/** The tallest trend bar, in px. */
export const TREND_HEIGHT = 24;

export interface ScreenStyles {
  /** The scroll view's content: padded. */
  content: ViewStyle;
  /** A tab's body inside the content: spaced, not padded again. */
  stack: ViewStyle;
  tabs: ViewStyle;
  tab: ViewStyle;
  tabSelected: ViewStyle;
  tabLabel: TextStyle;
  tabLabelSelected: TextStyle;
  muted: TextStyle;
  error: TextStyle;
  /** The line above a tab's cards: its text, then Expand all. */
  overview: ViewStyle;
  overviewText: TextStyle;
  link: TextStyle;
  /** Cards sit closer than the tab's other blocks (docs/design.md section 7). */
  cards: ViewStyle;
  /** A card's pressable summary, on the card's 16px rails. */
  cardHeader: ViewStyle;
  cardTitleRow: ViewStyle;
  cardTitle: TextStyle;
  cardMetaRow: ViewStyle;
  cardMeta: TextStyle;
  /** "Details" and its chevron, on the trailing rail. */
  detailsHint: ViewStyle;
  detailsHintText: TextStyle;
  statusText: Record<CardStatus, TextStyle>;
  statusColor: Record<CardStatus, string>;
  meters: ViewStyle;
  meter: ViewStyle;
  meterLabel: TextStyle;
  meterValue: TextStyle;
  meterTrack: ViewStyle;
  meterFill: Record<Level, ViewStyle>;
  /** A block of rows in an open card: one step smaller than a settings row. */
  block: ViewStyle;
  blockTitle: TextStyle;
  detailRow: ViewStyle;
  detailLabel: TextStyle;
  detailValue: TextStyle;
  trendRow: ViewStyle;
  trendLabel: TextStyle;
  trendBars: ViewStyle;
  trendBar: ViewStyle;
  trendRange: TextStyle;
  chevronColor: string;
}

/** Styles for the Resources screen, from the host theme. Typed, so no `as const` is needed. */
export function useScreenStyles(theme: PluginTheme): ScreenStyles {
  return useMemo((): ScreenStyles => {
    const { colors } = theme;
    // An OK host stays quiet: colour shows only where something needs attention.
    const statusColor: Record<CardStatus, string> = {
      ok: colors.statusSuccess,
      warning: colors.statusWarning,
      critical: colors.statusDanger,
      error: colors.statusDanger,
      waiting: colors.foregroundMuted,
    };
    const statusText = (color: string): TextStyle => ({ color, fontSize: 12 });
    const fill = (backgroundColor: string): ViewStyle => ({
      height: 4,
      borderRadius: 2,
      backgroundColor,
    });
    return {
      content: { padding: 16, gap: 16 },
      stack: { gap: 16 },
      tabs: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
      // The plugin UI kit has no SegmentedControl, so a tab is styled like one segment: the selected
      // one gets a quiet fill and foreground text, not an inverted accent fill, and no tab gets a
      // border of its own (docs/design.md sections 3-5). PluginTheme has no surface3, so the fill is
      // surface2, the sidebar's selected-row fill.
      tab: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6 },
      tabSelected: {
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 6,
        backgroundColor: colors.surface2,
      },
      tabLabel: { color: colors.foregroundMuted },
      tabLabelSelected: { color: colors.foreground },
      muted: { color: colors.foregroundMuted },
      error: { color: colors.statusDanger },
      overview: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      },
      overviewText: { flexShrink: 1, color: colors.foreground, fontSize: 14 },
      link: { color: colors.foregroundMuted, fontSize: 12, paddingVertical: 4 },
      cards: { gap: 8 },
      cardHeader: { paddingVertical: 12, paddingHorizontal: 16, gap: 6 },
      cardTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
      cardTitle: { flex: 1, color: colors.foreground, fontSize: 14, fontWeight: "500" },
      cardMetaRow: { flexDirection: "row", alignItems: "center", gap: 12 },
      cardMeta: { flex: 1, color: colors.foregroundMuted, fontSize: 12 },
      detailsHint: { flexDirection: "row", alignItems: "center", gap: 2 },
      detailsHintText: { color: colors.foregroundMuted, fontSize: 12 },
      statusText: {
        ok: statusText(colors.foregroundMuted),
        warning: statusText(colors.statusWarning),
        critical: statusText(colors.statusDanger),
        error: statusText(colors.statusDanger),
        waiting: statusText(colors.foregroundMuted),
      },
      statusColor,
      meters: { flexDirection: "row", gap: 12, marginTop: 2 },
      meter: { flex: 1, minWidth: 0, gap: 3 },
      meterLabel: { color: colors.foregroundMuted, fontSize: 12 },
      meterValue: { color: colors.foreground, fontSize: 12 },
      meterTrack: { height: 4, borderRadius: 2, backgroundColor: colors.surface2 },
      meterFill: {
        ok: fill(colors.foregroundMuted),
        warning: fill(colors.statusWarning),
        critical: fill(colors.statusDanger),
      },
      block: { paddingVertical: 12, paddingHorizontal: 16, gap: 8 },
      blockTitle: { color: colors.foregroundMuted, fontSize: 12, fontWeight: "500" },
      detailRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
      detailLabel: { flex: 1, color: colors.foreground, fontSize: 12 },
      detailValue: { flexShrink: 0, color: colors.foregroundMuted, fontSize: 12 },
      trendRow: { flexDirection: "row", alignItems: "flex-end", gap: 12 },
      trendLabel: { width: 56, color: colors.foreground, fontSize: 12 },
      trendBars: { flexDirection: "row", alignItems: "flex-end", gap: 1, height: TREND_HEIGHT },
      trendBar: { width: 3, borderRadius: 1, backgroundColor: colors.foregroundMuted },
      trendRange: { flex: 1, textAlign: "right", color: colors.foregroundMuted, fontSize: 12 },
      chevronColor: colors.foregroundMuted,
    };
  }, [theme]);
}
