import { useMemo } from "react";
import type { TextStyle, ViewStyle } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";

// docs/design.md section 4: a control is 44 tall where a finger drives it and 32 under a pointer.
const TOUCH_CONTROL = 44;
const POINTER_CONTROL = 32;
/** A reading column (docs/design.md section 7), a little wider for the chart. */
const COLUMN = 880;
/** The plot's height: the bars' full scale. */
export const PLOT_HEIGHT = 160;
/** A bar is never thicker than this, however wide its day's slot is. */
const BAR_MAX = 24;

export interface StatsStyles {
  screen: ViewStyle;
  content: ViewStyle;
  muted: TextStyle;
  error: TextStyle;

  /** The range's buttons, side by side. */
  ranges: ViewStyle;
  range: ViewStyle;
  rangeChosen: ViewStyle;
  rangeText: TextStyle;
  rangeTextChosen: TextStyle;

  tiles: ViewStyle;
  tile: ViewStyle;
  tileLabel: TextStyle;
  tileValue: TextStyle;

  section: ViewStyle;
  sectionHead: ViewStyle;
  sectionTitle: TextStyle;
  /** The picked day's numbers, or what picking does. */
  readout: TextStyle;

  // The chart.
  chart: ViewStyle;
  /** The scale's labels, left of the plot. */
  scale: ViewStyle;
  scaleLabel: TextStyle;
  /** The plot with the dates under it. */
  plotColumn: ViewStyle;
  plot: ViewStyle;
  gridLine: ViewStyle;
  /** The days, side by side over the full plot. */
  columns: ViewStyle;
  /** One day's slot: the whole height, so a finger does not have to find the bar. */
  column: ViewStyle;
  bar: ViewStyle;
  barPicked: ViewStyle;
  /** The dates under the plot. */
  axis: ViewStyle;
  axisLabel: TextStyle;
  /** A week's days: each under its own bar. */
  axisSlot: TextStyle;
  /** The button that swaps the chart for its table. */
  toggle: ViewStyle;
  togglePressed: ViewStyle;

  // The table of days, and the workspaces.
  rows: ViewStyle;
  row: ViewStyle;
  rowPressed: ViewStyle;
  rowHead: ViewStyle;
  rowName: TextStyle;
  rowFigure: TextStyle;
  track: ViewStyle;
  fill: ViewStyle;
  iconColor: string;
}

/** Styles for the Stats screen, from the host theme. `touch` is true where a finger drives it. */
export function useStatsStyles(theme: PluginTheme, touch: boolean): StatsStyles {
  return useMemo((): StatsStyles => {
    const { colors } = theme;
    const control = touch ? TOUCH_CONTROL : POINTER_CONTROL;
    const range: ViewStyle = {
      minHeight: control,
      paddingHorizontal: 14,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    };
    const rangeText: TextStyle = { color: colors.foregroundMuted, fontSize: 13, fontWeight: "500" };
    // The marks are neutral ink: the accent is under 3:1 against a dark surface in several
    // themes, and one series needs no colour to be told apart.
    const bar: ViewStyle = {
      width: "100%",
      maxWidth: BAR_MAX,
      minHeight: 2,
      borderTopLeftRadius: 4,
      borderTopRightRadius: 4,
      backgroundColor: colors.foregroundMuted,
    };
    const row: ViewStyle = { gap: 6, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 8 };
    return {
      screen: { flex: 1 },
      content: {
        width: "100%",
        maxWidth: COLUMN,
        alignSelf: "center",
        padding: 16,
        gap: 24,
      },
      muted: { color: colors.foregroundMuted, fontSize: 14, lineHeight: 20 },
      error: { color: colors.statusDanger, fontSize: 14, lineHeight: 20 },

      ranges: { flexDirection: "row", gap: 8 },
      range,
      rangeChosen: { ...range, backgroundColor: colors.surface2, borderColor: colors.surface2 },
      rangeText,
      rangeTextChosen: { ...rangeText, color: colors.foreground },

      tiles: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
      tile: {
        flexGrow: 1,
        // Three across on a phone.
        flexBasis: 100,
        gap: 4,
        padding: touch ? 12 : 16,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface1,
      },
      tileLabel: { color: colors.foregroundMuted, fontSize: 13 },
      tileValue: {
        color: colors.foreground,
        fontSize: touch ? 20 : 24,
        lineHeight: touch ? 26 : 30,
        fontWeight: "500",
        fontVariant: ["tabular-nums"],
      },

      section: { gap: 12 },
      sectionHead: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      },
      sectionTitle: { color: colors.foreground, fontSize: 15, fontWeight: "500" },
      readout: {
        color: colors.foregroundMuted,
        fontSize: 13,
        lineHeight: 18,
        fontVariant: ["tabular-nums"],
      },

      chart: { flexDirection: "row", gap: 8 },
      scale: { height: PLOT_HEIGHT, justifyContent: "space-between", alignItems: "flex-end" },
      scaleLabel: {
        color: colors.foregroundMuted,
        fontSize: 11,
        // Each label is centred on its line: half its height hangs past the plot's two ends.
        lineHeight: 14,
        marginVertical: -7,
        fontVariant: ["tabular-nums"],
      },
      plotColumn: { flex: 1, gap: 6 },
      plot: { height: PLOT_HEIGHT },
      gridLine: {
        position: "absolute",
        left: 0,
        right: 0,
        height: 1,
        backgroundColor: colors.border,
      },
      columns: { flex: 1, flexDirection: "row" },
      // One pixel of surface on each side of a bar: two between neighbours.
      column: { flex: 1, justifyContent: "flex-end", alignItems: "center", paddingHorizontal: 1 },
      bar,
      barPicked: { ...bar, backgroundColor: colors.foreground },
      axis: { flexDirection: "row", justifyContent: "space-between" },
      axisLabel: { color: colors.foregroundMuted, fontSize: 11, lineHeight: 14 },
      axisSlot: {
        flex: 1,
        textAlign: "center",
        color: colors.foregroundMuted,
        fontSize: 11,
        lineHeight: 14,
      },
      toggle: {
        width: control,
        height: control,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
      },
      togglePressed: {
        width: control,
        height: control,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.surface2,
      },

      rows: { gap: 2, marginHorizontal: -8 },
      row,
      rowPressed: { ...row, backgroundColor: colors.surface1 },
      rowHead: { flexDirection: "row", alignItems: "baseline", gap: 12 },
      rowName: { flex: 1, color: colors.foreground, fontSize: 14, lineHeight: 20 },
      rowFigure: {
        color: colors.foregroundMuted,
        fontSize: 13,
        lineHeight: 20,
        fontVariant: ["tabular-nums"],
      },
      track: { height: 4, borderRadius: 2, backgroundColor: colors.surface2, overflow: "hidden" },
      fill: { height: 4, borderRadius: 2, backgroundColor: colors.foregroundMuted },
      iconColor: colors.foregroundMuted,
    };
  }, [theme, touch]);
}
