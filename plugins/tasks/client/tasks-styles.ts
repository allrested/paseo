import { useMemo } from "react";
import type { ImageStyle, TextStyle, ViewStyle } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";

export interface TasksStyles {
  screen: ViewStyle;
  /** Wide layouts: the list beside the open task. */
  split: ViewStyle;
  listPane: ViewStyle;
  detailPane: ViewStyle;
  /** The way back to the list, above a page that covers it on a wide window. */
  back: ViewStyle;
  backPressed: ViewStyle;
  listContent: ViewStyle;
  searchRow: ViewStyle;
  search: TextStyle;
  placeholderColor: string;
  iconButton: ViewStyle;
  iconButtonBusy: ViewStyle;
  iconColor: string;
  section: ViewStyle;
  sectionTitle: TextStyle;
  card: ViewStyle;
  row: ViewStyle;
  rowDivided: ViewStyle;
  rowSelected: ViewStyle;
  rowBody: ViewStyle;
  rowTitle: TextStyle;
  rowKey: TextStyle;
  rowMeta: TextStyle;
  muted: TextStyle;
  /** A screen-level empty state: centered in the space it has. */
  empty: ViewStyle;
  emptyText: TextStyle;
  error: TextStyle;
  /** Lists that failed while another answered, above the rows. */
  banner: ViewStyle;
  detailContent: ViewStyle;
  heading: ViewStyle;
  eyebrow: TextStyle;
  title: TextStyle;
  facts: ViewStyle;
  fact: ViewStyle;
  factName: TextStyle;
  factValue: TextStyle;
  actions: ViewStyle;
  block: ViewStyle;
  body: TextStyle;
  comments: ViewStyle;
  comment: ViewStyle;
  input: TextStyle;
  /** Holds a button and the error under it. */
  buttonBox: ViewStyle;
  button: ViewStyle;
  buttonPressed: ViewStyle;
  buttonDisabled: ViewStyle;
  /** The plain button's fill: a layer of its own, so its opacity does not fade the label. */
  buttonFill: ViewStyle;
  buttonPrimary: ViewStyle;
  buttonPrimaryPressed: ViewStyle;
  buttonPrimaryDisabled: ViewStyle;
  buttonText: TextStyle;
  buttonPrimaryText: TextStyle;
  /** The label that is not showing, at no height: it keeps the button as wide as the longer one. */
  buttonSpacer: TextStyle;
  /** Laid over a chip, a row or a check while it is pressed. */
  pressed: ViewStyle;
  /** A form's one-line field. */
  field: TextStyle;
  chips: ViewStyle;
  chip: ViewStyle;
  chipSelected: ViewStyle;
  chipText: TextStyle;
  chipTextSelected: TextStyle;
  chipMarkColor: string;
  /** The place a new issue goes to, once it is picked, beside the way to change it. */
  picked: ViewStyle;
  pickedText: TextStyle;
  check: ViewStyle;
  checkBox: ViewStyle;
  checkBoxOn: ViewStyle;
  checkMarkColor: string;
  /** One review thread: where it is, what was said, and what can be done with it. */
  thread: ViewStyle;
  threadWhere: TextStyle;
  /** A thread's buttons, held to the top: a refusal under one must not push its neighbour down. */
  threadActions: ViewStyle;
  /** The pictures of a description, under its text. */
  pictures: ViewStyle;
  /** One picture; its widest and its shape are the picture's own. */
  picture: ImageStyle;
}

// docs/design.md section 4: a control is 44 tall where a finger drives it and 32 under a pointer.
const TOUCH_CONTROL = 44;
const POINTER_CONTROL = 32;
/** A reading column (docs/design.md section 7). */
const COLUMN = 720;

/**
 * Styles for the tasks screen, from the host theme. `touchScreen` is the device's fact: a tablet
 * with the sidebar docked is wide and still gets finger-sized controls.
 */
export function useTasksStyles(
  theme: PluginTheme,
  compact: boolean,
  touchScreen: boolean,
): TasksStyles {
  return useMemo((): TasksStyles => {
    const { colors } = theme;
    const touch = compact || touchScreen;
    const control = touch ? TOUCH_CONTROL : POINTER_CONTROL;
    const base: TextStyle = { fontSize: 14, lineHeight: 20 };
    const small: TextStyle = { fontSize: 12, lineHeight: 16 };
    // What is read, not chrome: the app's content sizes (docs/design.md section 3). 16 px is also
    // the size below which a phone browser zooms the page when a field takes focus.
    const content: TextStyle = touch
      ? { fontSize: 16, lineHeight: 24 }
      : { fontSize: 15, lineHeight: 22 };
    const button: ViewStyle = {
      minHeight: control,
      paddingHorizontal: touch ? 24 : 16,
      borderRadius: 9999,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
    };
    const buttonPrimary: ViewStyle = { ...button, backgroundColor: colors.accent };
    const back: ViewStyle = {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "flex-start",
      gap: 4,
      minHeight: control,
      // The chevron's ink starts a little inside its box: this puts it on the page's rail.
      paddingLeft: 12,
      paddingRight: 16,
      marginTop: 8,
    };
    const buttonLabel: TextStyle = { ...base, fontWeight: "500" };
    const iconButton: ViewStyle = {
      width: control,
      height: control,
      borderRadius: 9999,
      alignItems: "center",
      justifyContent: "center",
    };
    const row: ViewStyle = {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      minHeight: TOUCH_CONTROL,
      paddingVertical: 12,
      paddingHorizontal: 12,
    };
    const field: TextStyle = {
      ...(touch ? { fontSize: 16, lineHeight: 22 } : base),
      height: control,
      paddingVertical: 0,
      paddingHorizontal: 12,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface1,
      color: colors.foreground,
    };
    const chip: ViewStyle = {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      minHeight: control,
      maxWidth: "100%",
      paddingHorizontal: touch ? 16 : 12,
      borderRadius: 9999,
      borderWidth: 1,
      borderColor: colors.border,
    };
    const checkBox: ViewStyle = {
      width: 20,
      height: 20,
      borderRadius: 4,
      borderWidth: 1,
      borderColor: colors.foregroundMuted,
      alignItems: "center",
      justifyContent: "center",
    };
    return {
      screen: { flex: 1 },
      split: { flex: 1, flexDirection: "row" },
      // Its width is the screen's to give (tasks-screen.tsx splitListWidth).
      listPane: { borderRightWidth: 1, borderRightColor: colors.border },
      detailPane: { flex: 1, minWidth: 0 },
      back,
      backPressed: { ...back, opacity: 0.6 },
      listContent: { padding: 16, gap: 16 },
      searchRow: { flexDirection: "row", alignItems: "center", gap: 8 },
      search: { ...field, flex: 1, minWidth: 0 },
      placeholderColor: colors.foregroundMuted,
      iconButton,
      iconButtonBusy: { ...iconButton, opacity: 0.5 },
      iconColor: colors.foregroundMuted,
      section: { gap: 8 },
      sectionTitle: { ...small, color: colors.foregroundMuted, fontWeight: "500" },
      card: {
        borderWidth: 1,
        borderRadius: 8,
        borderColor: colors.border,
        backgroundColor: colors.surface1,
        overflow: "hidden",
      },
      row,
      rowDivided: { ...row, borderTopWidth: 1, borderTopColor: colors.border },
      rowSelected: { backgroundColor: colors.surface2 },
      rowBody: { flex: 1, minWidth: 0, gap: 4 },
      rowTitle: { ...base, color: colors.foreground },
      rowKey: { color: colors.foregroundMuted },
      rowMeta: { ...small, color: colors.foregroundMuted },
      muted: { ...base, color: colors.foregroundMuted },
      empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
      emptyText: { ...base, color: colors.foregroundMuted, textAlign: "center" },
      error: { ...small, color: colors.statusDanger },
      banner: {
        gap: 4,
        padding: 12,
        borderWidth: 1,
        borderRadius: 8,
        borderColor: colors.border,
      },
      detailContent: {
        width: "100%",
        maxWidth: COLUMN,
        alignSelf: "center",
        padding: 16,
        gap: 24,
      },
      heading: { gap: 4 },
      eyebrow: { ...small, color: colors.foregroundMuted },
      title: { fontSize: 16, lineHeight: 24, fontWeight: "500", color: colors.foreground },
      facts: { gap: 4 },
      fact: { flexDirection: "row", gap: 12 },
      factName: { ...base, width: 96, flexShrink: 0, color: colors.foregroundMuted },
      factValue: { ...base, flex: 1, minWidth: 0, color: colors.foreground },
      actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
      block: { gap: 8 },
      body: { ...content, color: colors.foreground },
      comments: { gap: 16 },
      comment: { gap: 4 },
      input: {
        ...content,
        minHeight: (content.lineHeight ?? 22) * 3 + 26,
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface1,
        color: colors.foreground,
        textAlignVertical: "top",
      },
      buttonBox: { flexShrink: 1, maxWidth: "100%", gap: 4, alignItems: "flex-start" },
      button,
      buttonPressed: { ...button, opacity: 0.85 },
      buttonDisabled: { ...button, opacity: 0.5 },
      // The app's secondary button is surface3, which PluginTheme lacks. A fifth of the muted
      // grey stands in for it on every theme (the office's buttons measure it).
      buttonFill: {
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        backgroundColor: colors.foregroundMuted,
        opacity: 0.2,
      },
      buttonPrimary,
      buttonPrimaryPressed: { ...buttonPrimary, opacity: 0.85 },
      buttonPrimaryDisabled: { ...buttonPrimary, opacity: 0.5 },
      buttonText: { ...buttonLabel, color: colors.foreground },
      buttonPrimaryText: { ...buttonLabel, color: colors.accentForeground },
      buttonSpacer: { ...buttonLabel, height: 0, opacity: 0 },
      pressed: { opacity: 0.6 },
      field,
      chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
      chip,
      // The pick is a filled chip with the text's own colour around it, and a check inside.
      chipSelected: { ...chip, borderColor: colors.foreground, backgroundColor: colors.surface2 },
      chipText: { ...base, flexShrink: 1, color: colors.foregroundMuted },
      chipTextSelected: { ...base, flexShrink: 1, fontWeight: "500", color: colors.foreground },
      chipMarkColor: colors.foreground,
      picked: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 },
      pickedText: { ...base, flexShrink: 1, color: colors.foreground },
      check: {
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "flex-start",
        gap: 8,
        minHeight: control,
      },
      checkBox,
      checkBoxOn: { ...checkBox, borderColor: colors.accent, backgroundColor: colors.accent },
      checkMarkColor: colors.accentForeground,
      thread: {
        gap: 12,
        padding: 12,
        borderWidth: 1,
        borderRadius: 8,
        borderColor: colors.border,
      },
      threadWhere: { ...small, fontWeight: "500", color: colors.foreground },
      threadActions: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: 8 },
      pictures: { gap: 12 },
      picture: { width: "100%", borderRadius: 4 },
    };
  }, [theme, compact, touchScreen]);
}
