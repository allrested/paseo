import { useMemo } from "react";
import type { ImageStyle, TextStyle, ViewStyle } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";

// The office's conventions (plugins/office/client/styles.ts), so the two built-ins read as one
// app: touch-sized controls in the compact layout or on a touch screen, pill buttons with a
// fill layer, foreground for the thing acted on and foregroundMuted for context (docs/design.md).

const TOUCH_CONTROL = 44;
const POINTER_CONTROL = 32;
const COLUMN = 720;

export interface DesignStyles {
  screen: ViewStyle;
  /** The title row: on the column's rails, the action on the trailing one. */
  header: ViewStyle;
  /** The title row over the web editor, which fills the panel: off the column, on its edges. */
  editorHeader: ViewStyle;
  headerLead: ViewStyle;
  title: TextStyle;
  content: ViewStyle;
  /** A centred empty or off state: a muted noun phrase and at most one line under it. */
  emptyBlock: ViewStyle;
  emptyTitle: TextStyle;
  emptyHint: TextStyle;
  /** A row and its More button, side by side. */
  rowLine: ViewStyle;
  row: ViewStyle;
  rowBody: ViewStyle;
  rowTitle: TextStyle;
  detail: Record<"muted" | "warning" | "danger", TextStyle>;
  /** A row's own small action, a circle as tall as a control. */
  iconButton: ViewStyle;
  iconColor: string;
  banner: ViewStyle;
  /** The banner under the web editor's full-width title row, on the same edges. */
  editorBanner: ViewStyle;
  bannerText: Record<"muted" | "warning" | "danger", TextStyle>;
  sectionLabel: TextStyle;
  /** The phone picture's frame: the page's own picture, contained, on a quiet surface. */
  pictureFrame: ViewStyle;
  picture: ImageStyle;
  pictureHint: TextStyle;
  pictureProblem: TextStyle;
  threads: ViewStyle;
  threadsEmpty: TextStyle;
  thread: ViewStyle;
  threadBody: ViewStyle;
  threadAuthor: TextStyle;
  threadText: TextStyle;
  sheet: ViewStyle;
  sheetText: TextStyle;
  sheetActions: ViewStyle;
  /** A removal on the leading edge, the sheet's own action on the trailing one. */
  sheetActionsSplit: ViewStyle;
  input: TextStyle;
  inputMultiline: TextStyle;
  placeholderColor: string;
  chips: ViewStyle;
  chip: ViewStyle;
  chipSelected: ViewStyle;
  chipLabel: TextStyle;
  /** Holds a button and the error under it. */
  actionButton: ViewStyle;
  button: ViewStyle;
  buttonFill: ViewStyle;
  buttonSpacer: TextStyle;
  buttonPressed: ViewStyle;
  buttonPrimary: ViewStyle;
  buttonPrimaryPressed: ViewStyle;
  buttonDisabled: ViewStyle;
  buttonPrimaryDisabled: ViewStyle;
  buttonText: TextStyle;
  buttonDangerText: TextStyle;
  buttonPrimaryText: TextStyle;
  actionError: TextStyle;
  editorFrame: ViewStyle;
  modeBar: ViewStyle;
  outline: ViewStyle;
  outlineRing: ViewStyle;
  outlineInner: ViewStyle;
  iconButtonDisabled: ViewStyle;
  /** The picked layer's tools under the picture: four rows that keep their height. */
  inspector: ViewStyle;
  inspectorHead: ViewStyle;
  inspectorLayers: ViewStyle;
  inspectorTools: ViewStyle;
  inspectorPanel: ViewStyle;
  inspectorSpacer: ViewStyle;
  chipRow: ViewStyle;
  nudgeButton: ViewStyle;
  nudgeButtonDisabled: ViewStyle;
  nudgeColor: string;
  nudgeText: TextStyle;
  inputInline: TextStyle;
  colorChip: ViewStyle;
  colorChipSelected: ViewStyle;
  swatch: ViewStyle;
}

export function useDesignStyles(
  theme: PluginTheme,
  compact: boolean,
  touchScreen: boolean,
): DesignStyles {
  return useMemo((): DesignStyles => {
    const { colors } = theme;
    const pad = compact ? 12 : 16;
    const touch = compact || touchScreen;
    const controlHeight = touch ? TOUCH_CONTROL : POINTER_CONTROL;
    const base: TextStyle = { fontSize: 14, lineHeight: 20 };
    const small: TextStyle = { fontSize: 12, lineHeight: 16 };
    // Content text, and 16 px keeps a phone browser from zooming when a field takes focus.
    const prompt: TextStyle = touch
      ? { fontSize: 16, lineHeight: 22 }
      : { fontSize: 15, lineHeight: 21 };
    const column: ViewStyle = { width: "100%", maxWidth: COLUMN + pad * 2, alignSelf: "center" };
    // A fifth of the muted grey: the app's surface3, which PluginTheme lacks (see the office).
    const fill: ViewStyle = {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: colors.foregroundMuted,
      opacity: 0.2,
    };
    const button: ViewStyle = {
      minHeight: controlHeight,
      paddingHorizontal: touch ? 24 : 16,
      borderRadius: 9999,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
    };
    const buttonPrimary: ViewStyle = { ...button, backgroundColor: colors.accent };
    const buttonLabel: TextStyle = { ...base, fontWeight: "500" };
    const row: ViewStyle = {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: TOUCH_CONTROL,
      paddingVertical: 8,
      paddingHorizontal: pad,
      borderRadius: 12,
      overflow: "hidden",
    };
    const iconButton: ViewStyle = {
      width: controlHeight,
      height: controlHeight,
      borderRadius: controlHeight / 2,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
    };
    const chip: ViewStyle = {
      minHeight: controlHeight,
      maxWidth: 240,
      paddingHorizontal: 16,
      borderRadius: 9999,
      borderWidth: 1,
      borderColor: colors.border,
      justifyContent: "center",
    };
    const input: TextStyle = {
      ...prompt,
      minHeight: controlHeight,
      paddingVertical: touch ? 10 : 6,
      paddingHorizontal: 16,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface1,
      color: colors.foreground,
    };
    return {
      screen: { flex: 1, backgroundColor: colors.surface0 },
      header: {
        ...column,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        minHeight: controlHeight + 16,
        paddingHorizontal: pad,
        paddingVertical: 8,
      },
      editorHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        minHeight: controlHeight + 16,
        paddingHorizontal: pad,
        paddingVertical: 8,
      },
      headerLead: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 4 },
      title: { ...base, fontWeight: "500", color: colors.foreground, flexShrink: 1 },
      content: { ...column, paddingHorizontal: pad - 4, paddingBottom: 24, gap: 4 },
      emptyBlock: {
        ...column,
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        padding: 24,
      },
      emptyTitle: { ...base, color: colors.foregroundMuted, textAlign: "center" },
      emptyHint: { ...small, color: colors.foregroundMuted, textAlign: "center", maxWidth: 320 },
      rowLine: { flexDirection: "row", alignItems: "center", gap: 4 },
      row,
      rowBody: { flex: 1, minWidth: 0, gap: 2 },
      rowTitle: { ...base, color: colors.foreground },
      detail: {
        muted: { ...small, color: colors.foregroundMuted },
        warning: { ...small, color: colors.statusWarning },
        danger: { ...small, color: colors.statusDanger },
      },
      iconButton,
      iconColor: colors.foregroundMuted,
      banner: {
        ...column,
        paddingHorizontal: pad,
        paddingBottom: 8,
      },
      editorBanner: { paddingHorizontal: pad, paddingBottom: 8 },
      bannerText: {
        muted: { ...small, color: colors.foregroundMuted },
        warning: { ...small, color: colors.statusWarning },
        danger: { ...small, color: colors.statusDanger },
      },
      sectionLabel: {
        ...small,
        fontWeight: "500",
        color: colors.foregroundMuted,
        paddingHorizontal: pad,
        paddingTop: 16,
        paddingBottom: 4,
      },
      pictureFrame: {
        flex: 1,
        minHeight: 200,
        marginHorizontal: pad,
        borderRadius: 12,
        backgroundColor: colors.surface1,
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
      },
      picture: { width: "100%", height: "100%" },
      pictureHint: {
        ...small,
        color: colors.foregroundMuted,
        paddingHorizontal: pad,
        paddingTop: 8,
      },
      pictureProblem: {
        ...small,
        color: colors.statusDanger,
        paddingHorizontal: pad,
        paddingTop: 8,
      },
      // The picture gives way first: a squeezed list would cut its rows and their Send buttons.
      threads: { maxHeight: 240, flexShrink: 0 },
      threadsEmpty: { ...small, color: colors.foregroundMuted, paddingHorizontal: pad },
      // Not row's flex: 1. On web flex: 0 is a zero basis, which cut a row to its minimum height.
      thread: {
        ...row,
        flex: undefined,
        flexGrow: 0,
        flexShrink: 0,
        flexBasis: "auto",
        alignItems: "flex-start",
        paddingVertical: 10,
      },
      threadBody: { flex: 1, minWidth: 0, gap: 2 },
      threadAuthor: { ...small, color: colors.foregroundMuted },
      threadText: { ...base, color: colors.foreground },
      sheet: { gap: 16 },
      sheetText: { ...base, color: colors.foregroundMuted },
      sheetActions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 8 },
      sheetActionsSplit: {
        flexDirection: "row",
        flexWrap: "wrap",
        justifyContent: "space-between",
        gap: 8,
      },
      input,
      inputMultiline: {
        ...input,
        minHeight: (prompt.lineHeight ?? 22) * 3 + 26,
        textAlignVertical: "top",
      },
      placeholderColor: colors.foregroundMuted,
      chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
      chip,
      // Two pixels of outline, the padding giving the pixel back, so choosing never shifts a chip.
      chipSelected: {
        ...chip,
        paddingHorizontal: 15,
        borderWidth: 2,
        borderColor: colors.foreground,
      },
      chipLabel: { ...base, color: colors.foreground },
      actionButton: { flexShrink: 1, maxWidth: "100%", gap: 4 },
      button,
      buttonFill: fill,
      buttonSpacer: { ...buttonLabel, height: 0, opacity: 0 },
      buttonPressed: { ...button, opacity: 0.85 },
      buttonPrimary,
      buttonPrimaryPressed: { ...buttonPrimary, opacity: 0.85 },
      buttonDisabled: { ...button, opacity: 0.5 },
      buttonPrimaryDisabled: { ...buttonPrimary, opacity: 0.5 },
      buttonText: { ...buttonLabel, color: colors.foreground },
      buttonDangerText: { ...buttonLabel, color: colors.statusDanger },
      buttonPrimaryText: { ...buttonLabel, color: colors.accentForeground },
      actionError: { ...small, color: colors.statusDanger },
      editorFrame: { flex: 1, borderTopWidth: 1, borderTopColor: colors.border },
      modeBar: {
        ...column,
        flexDirection: "row",
        gap: 8,
        paddingHorizontal: pad,
        paddingBottom: 8,
      },
      // The picked layer in the picture. The accent line has a light line each side, so it shows
      // on a layer of the accent's own colour too.
      outline: {
        position: "absolute",
        borderWidth: 1,
        borderColor: colors.accentForeground,
        borderRadius: 4,
      },
      outlineRing: { flex: 1, borderWidth: 2, borderColor: colors.accent, borderRadius: 3 },
      outlineInner: {
        flex: 1,
        borderWidth: 1,
        borderColor: colors.accentForeground,
        borderRadius: 1,
      },
      iconButtonDisabled: { ...iconButton, opacity: 0.4 },
      inspector: { ...column, paddingHorizontal: pad, paddingTop: 8, paddingBottom: 12, gap: 8 },
      inspectorHead: { flexDirection: "row", alignItems: "center", gap: 4 },
      // Each list scrolls sideways in its own row and never grows the block.
      inspectorLayers: { flex: 1, flexGrow: 1, flexShrink: 1 },
      inspectorTools: { flexGrow: 0, flexShrink: 0 },
      inspectorPanel: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        height: controlHeight,
      },
      inspectorSpacer: { flex: 1 },
      chipRow: { flexDirection: "row", alignItems: "center", gap: 8 },
      nudgeButton: { ...iconButton, borderWidth: 1, borderColor: colors.border },
      nudgeButtonDisabled: {
        ...iconButton,
        borderWidth: 1,
        borderColor: colors.border,
        opacity: 0.4,
      },
      nudgeColor: colors.foreground,
      nudgeText: { ...small, fontWeight: "500", color: colors.foreground },
      inputInline: {
        ...input,
        flex: 1,
        minWidth: 0,
        height: controlHeight,
        paddingVertical: touch ? 10 : 6,
      },
      colorChip: { ...chip, flexDirection: "row", alignItems: "center", gap: 8 },
      colorChipSelected: {
        ...chip,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 15,
        borderWidth: 2,
        borderColor: colors.foreground,
      },
      swatch: {
        width: 16,
        height: 16,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.border,
      },
    };
  }, [theme, compact, touchScreen]);
}
