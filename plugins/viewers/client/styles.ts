import { useMemo } from "react";
import { Platform, type ImageStyle, type TextStyle, type ViewStyle } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";

const MONOSPACE = Platform.select({ ios: "Menlo", default: "monospace" });

// docs/design.md section 4: a control is 44 tall where a finger drives it and 32 under a pointer.
const TOUCH_CONTROL = 44;
const POINTER_CONTROL = 32;
/** A reading column (docs/design.md section 7), a little wider for code. */
const COLUMN = 880;

export interface ViewerStyles {
  /** Fills the tab. */
  panel: ViewStyle;
  /** A sentence in the middle of the tab: nothing to show, or why. */
  message: ViewStyle;
  muted: TextStyle;
  danger: TextStyle;

  // The table.
  toolbar: ViewStyle;
  search: TextStyle;
  placeholderColor: string;
  count: TextStyle;
  /** Scrolls sideways; the rows scroll down inside it. */
  sideways: ViewStyle;
  sidewaysContent: ViewStyle;
  grid: ViewStyle;
  rows: ViewStyle;
  headRow: ViewStyle;
  row: ViewStyle;
  /** A row's height while its cells are on one line. */
  rowHeight: number;
  /** The row's number in the file. */
  number: TextStyle;
  head: ViewStyle;
  headPressed: ViewStyle;
  headText: TextStyle;
  headTextNumber: TextStyle;
  cell: TextStyle;
  cellNumber: TextStyle;
  iconColor: string;
  sortedColor: string;
  /** Under the names of a table with no rows to show. */
  note: TextStyle;

  // The notebook.
  cells: ViewStyle;
  codeCell: ViewStyle;
  /** "[3]": which run the cell's output is from. */
  run: TextStyle;
  mono: TextStyle;
  stderr: TextStyle;
  errorText: TextStyle;
  outputs: ViewStyle;
  output: ViewStyle;
  outputLabel: TextStyle;
  picture: ImageStyle;
}

/** Styles for the viewers, from the host theme. `touch` is true where a finger drives the tab. */
export function useViewerStyles(theme: PluginTheme, touch: boolean): ViewerStyles {
  return useMemo((): ViewerStyles => {
    const { colors } = theme;
    const control = touch ? TOUCH_CONTROL : POINTER_CONTROL;
    const line: ViewStyle = {
      flexDirection: "row",
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    };
    const cell: TextStyle = {
      color: colors.foreground,
      fontSize: 13,
      lineHeight: 18,
      paddingHorizontal: 12,
      paddingVertical: (control - 18) / 2,
    };
    const head: ViewStyle = {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      minHeight: control,
      paddingHorizontal: 12,
    };
    const headText: TextStyle = {
      flex: 1,
      color: colors.foreground,
      fontSize: 13,
      fontWeight: "500",
    };
    const mono: TextStyle = {
      color: colors.foreground,
      fontFamily: MONOSPACE,
      fontSize: 13,
      lineHeight: 19,
    };
    return {
      panel: { flex: 1, backgroundColor: colors.surface0 },
      message: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
      muted: { color: colors.foregroundMuted, fontSize: 14, lineHeight: 20, textAlign: "center" },
      danger: { color: colors.statusDanger, fontSize: 14, lineHeight: 20, textAlign: "center" },

      toolbar: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      },
      search: {
        flex: 1,
        maxWidth: 360,
        minHeight: control,
        paddingHorizontal: 12,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 8,
        backgroundColor: colors.surface1,
        color: colors.foreground,
        // Under 16 a phone's browser zooms the page when the field takes focus.
        fontSize: touch ? 16 : 14,
      },
      placeholderColor: colors.foregroundMuted,
      count: {
        color: colors.foregroundMuted,
        fontSize: 13,
        fontVariant: ["tabular-nums"],
      },
      sideways: { flex: 1 },
      sidewaysContent: { flexGrow: 1 },
      grid: { flexGrow: 1 },
      rows: { flex: 1 },
      headRow: { ...line, backgroundColor: colors.surface1 },
      row: line,
      // The cell's line and padding, and the rule under the row.
      rowHeight: control + 1,
      number: {
        ...cell,
        color: colors.foregroundMuted,
        textAlign: "right",
        fontVariant: ["tabular-nums"],
      },
      head,
      headPressed: { ...head, backgroundColor: colors.surface2 },
      headText,
      headTextNumber: { ...headText, textAlign: "right" },
      cell,
      cellNumber: { ...cell, textAlign: "right", fontVariant: ["tabular-nums"] },
      iconColor: colors.foregroundMuted,
      sortedColor: colors.foreground,
      note: { color: colors.foregroundMuted, fontSize: 14, lineHeight: 20, padding: 12 },

      cells: {
        width: "100%",
        maxWidth: COLUMN,
        alignSelf: "center",
        padding: 16,
        gap: 16,
      },
      codeCell: { gap: 4 },
      run: { color: colors.foregroundMuted, fontFamily: MONOSPACE, fontSize: 12 },
      mono,
      stderr: { ...mono, color: colors.statusWarning },
      errorText: { ...mono, color: colors.statusDanger },
      outputs: { gap: 8, paddingLeft: 12, borderLeftWidth: 2, borderLeftColor: colors.border },
      output: { gap: 2 },
      outputLabel: { color: colors.foregroundMuted, fontSize: 12 },
      picture: { width: "100%", borderRadius: 4, backgroundColor: "#ffffff" },
    };
  }, [theme, touch]);
}
