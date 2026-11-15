import { useMemo } from "react";
import { Platform, type TextStyle, type ViewStyle } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";

const MONOSPACE = Platform.select({ ios: "Menlo", default: "monospace" });

// docs/design.md section 4: a control is 44 tall where a finger drives it and 32 under a pointer.
const TOUCH_CONTROL = 44;
const POINTER_CONTROL = 32;
/** A reading column (docs/design.md section 7), a little wider for code. */
const COLUMN = 960;
/** The stripe beside a line an agent wrote. */
const STRIPE = 3;

export interface AttributionStyles {
  /** Fills the tab. */
  panel: ViewStyle;
  /** The column the content is held to. */
  column: ViewStyle;
  /** A sentence in the middle of the tab: nothing to show, or why. */
  message: ViewStyle;
  messageTitle: TextStyle;
  muted: TextStyle;
  danger: TextStyle;
  iconColor: string;
  iconSize: number;

  // The bar on top of both views.
  bar: ViewStyle;
  barText: ViewStyle;
  title: TextStyle;
  subtitle: TextStyle;
  /** A square button with one icon. */
  iconButton: ViewStyle;
  iconButtonPressed: ViewStyle;
  /** A button with words. */
  button: ViewStyle;
  buttonPressed: ViewStyle;
  buttonText: TextStyle;

  // The list of files.
  list: ViewStyle;
  listContent: ViewStyle;
  file: ViewStyle;
  filePressed: ViewStyle;
  fileMain: ViewStyle;
  fileName: TextStyle;
  fileFolder: TextStyle;
  fileSide: ViewStyle;
  fileAgents: TextStyle;
  fileWhen: TextStyle;

  // One file: the agents on top, then the lines.
  legend: ViewStyle;
  chip: ViewStyle;
  chipChosen: ViewStyle;
  chipNumber: ViewStyle;
  chipNumberChosen: ViewStyle;
  chipNumberText: TextStyle;
  chipNumberTextChosen: TextStyle;
  chipName: TextStyle;
  chipCount: TextStyle;
  lines: ViewStyle;
  line: ViewStyle;
  lineChosen: ViewStyle;
  linePressed: ViewStyle;
  /** Beside every line: clear for a line no agent wrote. */
  stripe: ViewStyle;
  stripeAgent: ViewStyle;
  stripeChosen: ViewStyle;
  /** The agents' numbers, on a run's first line. */
  gutter: TextStyle;
  gutterChosen: TextStyle;
  lineNumber: TextStyle;
  code: TextStyle;

  // The turn of the chosen line, under the lines.
  detail: ViewStyle;
  detailText: ViewStyle;
  detailTitle: TextStyle;
  detailAgents: ViewStyle;
  detailAgent: ViewStyle;
  detailName: TextStyle;
}

export function useAttributionStyles(theme: PluginTheme, touch: boolean, compact: boolean) {
  return useMemo((): AttributionStyles => {
    const { colors } = theme;
    const control = touch ? TOUCH_CONTROL : POINTER_CONTROL;
    const edge = compact ? 12 : 20;
    const pressable: ViewStyle = {
      minHeight: control,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
    };
    const button: ViewStyle = {
      ...pressable,
      paddingHorizontal: 12,
      borderWidth: 1,
      borderColor: colors.border,
    };
    const chip: ViewStyle = {
      minHeight: control,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingLeft: 6,
      paddingRight: 12,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
    };
    const chipNumber: ViewStyle = {
      minWidth: 20,
      height: 20,
      paddingHorizontal: 4,
      borderRadius: 4,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surface2,
    };
    const line: ViewStyle = { flexDirection: "row", alignItems: "stretch", minHeight: 20 };
    const stripe: ViewStyle = { width: STRIPE, backgroundColor: "transparent" };
    const gutter: TextStyle = {
      width: 34,
      paddingLeft: 6,
      color: colors.foregroundMuted,
      fontFamily: MONOSPACE,
      fontSize: 11,
      lineHeight: 20,
    };
    const file: ViewStyle = {
      minHeight: Math.max(control, 44),
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: edge,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    };
    return {
      panel: { flex: 1, backgroundColor: colors.surface0 },
      column: { flex: 1, width: "100%", maxWidth: COLUMN, alignSelf: "center" },
      message: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 24 },
      messageTitle: {
        color: colors.foreground,
        fontSize: 15,
        fontWeight: "500",
        textAlign: "center",
      },
      muted: { color: colors.foregroundMuted, fontSize: 13, lineHeight: 18, textAlign: "center" },
      danger: { color: colors.statusDanger, fontSize: 13, lineHeight: 18, textAlign: "center" },
      iconColor: colors.foregroundMuted,
      iconSize: 16,

      bar: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: edge,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      },
      barText: { flex: 1, minWidth: 0, gap: 2 },
      title: { color: colors.foreground, fontSize: 15, fontWeight: "500" },
      subtitle: { color: colors.foregroundMuted, fontSize: 12 },
      iconButton: { ...pressable, width: control },
      iconButtonPressed: { ...pressable, width: control, backgroundColor: colors.surface2 },
      button,
      buttonPressed: { ...button, backgroundColor: colors.surface2 },
      buttonText: { color: colors.foreground, fontSize: 13, fontWeight: "500" },

      list: { flex: 1 },
      listContent: { paddingBottom: 24 },
      file,
      filePressed: { ...file, backgroundColor: colors.surface1 },
      fileMain: { flex: 1, minWidth: 0, gap: 2 },
      fileName: { color: colors.foreground, fontSize: 14, fontWeight: "500" },
      fileFolder: { color: colors.foregroundMuted, fontSize: 12 },
      fileSide: { alignItems: "flex-end", gap: 2, maxWidth: "45%" },
      fileAgents: { color: colors.foreground, fontSize: 12 },
      fileWhen: { color: colors.foregroundMuted, fontSize: 12 },

      legend: {
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: edge,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      },
      chip,
      chipChosen: { ...chip, borderColor: colors.accent, backgroundColor: colors.surface2 },
      chipNumber,
      chipNumberChosen: { ...chipNumber, backgroundColor: colors.accent },
      chipNumberText: {
        color: colors.foreground,
        fontFamily: MONOSPACE,
        fontSize: 11,
        fontWeight: "600",
      },
      chipNumberTextChosen: {
        color: colors.accentForeground,
        fontFamily: MONOSPACE,
        fontSize: 11,
        fontWeight: "600",
      },
      chipName: { color: colors.foreground, fontSize: 13, flexShrink: 1 },
      chipCount: { color: colors.foregroundMuted, fontSize: 12 },
      lines: { flex: 1 },
      line,
      lineChosen: { ...line, backgroundColor: colors.surface2 },
      linePressed: { ...line, backgroundColor: colors.surface1 },
      stripe,
      // Neutral ink, so the mark is plain in every theme; the accent is the chosen agent's.
      stripeAgent: { ...stripe, backgroundColor: colors.foregroundMuted },
      stripeChosen: { ...stripe, backgroundColor: colors.accent },
      gutter,
      gutterChosen: { ...gutter, color: colors.foreground, fontWeight: "600" },
      lineNumber: {
        width: 44,
        paddingRight: 12,
        textAlign: "right",
        color: colors.foregroundMuted,
        fontFamily: MONOSPACE,
        fontSize: 12,
        lineHeight: 20,
      },
      code: {
        flex: 1,
        minWidth: 0,
        paddingRight: edge,
        color: colors.foreground,
        fontFamily: MONOSPACE,
        fontSize: 12,
        lineHeight: 20,
      },

      detail: {
        flexDirection: "row",
        alignItems: compact ? "flex-start" : "center",
        gap: 12,
        paddingHorizontal: edge,
        paddingVertical: 12,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        backgroundColor: colors.surface1,
      },
      detailText: { flex: 1, minWidth: 0, gap: 6 },
      detailTitle: { color: colors.foreground, fontSize: 13, fontWeight: "500" },
      detailAgents: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 16 },
      detailAgent: { flexDirection: "row", alignItems: "center", gap: 8 },
      detailName: { color: colors.foreground, fontSize: 13 },
    };
  }, [theme, touch, compact]);
}
