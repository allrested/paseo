import { useMemo } from "react";
import type { TextStyle, ViewStyle } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import type { AttentionReason, DotTone } from "./model.js";

export interface OfficeStyles {
  screen: ViewStyle;
  header: ViewStyle;
  /** The row of switches: it wraps on a phone, and every line ends on the trailing rail. */
  headerControls: ViewStyle;
  /** The switches' failures, one line each, under their row. */
  headerProblems: ViewStyle;
  control: ViewStyle;
  controlDisabled: ViewStyle;
  controlLabel: TextStyle;
  /** The switch the surface draws itself: its track on and off, and the thumb in each. */
  switchOn: ViewStyle;
  switchOff: ViewStyle;
  switchOnThumb: ViewStyle;
  switchOffThumb: ViewStyle;
  placeholderColor: string;
  content: ViewStyle;
  muted: TextStyle;
  banner: ViewStyle;
  /** Holds the banner in the column and gives it the side padding. */
  bannerSlot: ViewStyle;
  bannerText: TextStyle;
  /**
   * Holds the strip's scroller: inside the cards' rails on a wide screen, so scrolled entries
   * stop where the cards do, and to the screen edges on a phone.
   */
  stripRail: ViewStyle;
  /** The strip's scroller, as wide as its rail. */
  stripScroll: ViewStyle;
  strip: ViewStyle;
  stripItem: ViewStyle;
  stripItemPressed: ViewStyle;
  /** The fill of a row or a strip entry under a finger or a pointer: a layer, as buttonFill is. */
  pressedFill: ViewStyle;
  stripBody: ViewStyle;
  stripTitle: TextStyle;
  stripReason: Record<AttentionReason, TextStyle>;
  card: ViewStyle;
  cardHeader: ViewStyle;
  cardTitle: TextStyle;
  cardSubtitle: TextStyle;
  empty: TextStyle;
  /** The hairline above a top-level agent. A child has none, so it reads as part of its parent. */
  rowDivider: ViewStyle;
  /** Under the last child of a parent, so the block ends as far above the next hairline as a row. */
  rowGroupEnd: ViewStyle;
  row: ViewStyle;
  rowPressed: ViewStyle;
  rowChild: ViewStyle;
  rowChildPressed: ViewStyle;
  /** The dot's slot: as tall as a title line, so the dot centres on the first line of text. */
  lead: ViewStyle;
  rowBody: ViewStyle;
  rowHeading: ViewStyle;
  rowTitle: TextStyle;
  rowState: Record<DotTone, TextStyle>;
  rowMeta: TextStyle;
  rowActivity: TextStyle;
  /** A row's permission requests, on the row's text rail. */
  rowPermissions: ViewStyle;
  rowChildPermissions: ViewStyle;
  permission: ViewStyle;
  permissionTitle: TextStyle;
  actions: ViewStyle;
  dot: Record<DotTone, ViewStyle>;
  /** Holds a button and the error under it. */
  actionButton: ViewStyle;
  button: ViewStyle;
  /** The plain button's fill: a layer of its own, so its opacity does not fade the label. */
  buttonFill: ViewStyle;
  /** The label that is not showing, at no height: it keeps the button as wide as the longer one. */
  buttonSpacer: TextStyle;
  buttonPressed: ViewStyle;
  buttonPrimary: ViewStyle;
  buttonPrimaryPressed: ViewStyle;
  buttonDisabled: ViewStyle;
  buttonPrimaryDisabled: ViewStyle;
  buttonText: TextStyle;
  buttonPrimaryText: TextStyle;
  actionError: TextStyle;
  sheet: ViewStyle;
  sheetStatus: ViewStyle;
  /** A row of buttons in the card and the error under it. */
  sheetActions: ViewStyle;
  sheetField: ViewStyle;
  sheetLabel: TextStyle;
  sheetText: TextStyle;
  input: TextStyle;
  boardSection: ViewStyle;
  boardTitleRow: ViewStyle;
  /** The board's name and, beside it, that it is empty. */
  boardHeading: ViewStyle;
  boardTitle: TextStyle;
  /** The posts in the board sheet. */
  boardPosts: ViewStyle;
  /** One post in the sheet with its buttons. */
  boardPost: ViewStyle;
  post: ViewStyle;
  postMeta: TextStyle;
  postText: TextStyle;
  chips: ViewStyle;
  /** A row of chips that scrolls sideways: its scroller, and the row inside it. */
  chipScroll: ViewStyle;
  chipRow: ViewStyle;
  chip: ViewStyle;
  chipSelected: ViewStyle;
  chipText: TextStyle;
  chipTextSelected: TextStyle;
  scene: ViewStyle;
  sceneStatus: TextStyle;
}

// The app's two control sizes (packages/app/src/components/ui/control-geometry.ts).
const TOUCH_CONTROL = 44;
const POINTER_CONTROL = 32;
// The app's two switch sizes (SWITCH_TOUCH and SWITCH_POINTER in the same file).
const TOUCH_SWITCH = { width: 44, height: 26, thumb: 22 };
const POINTER_SWITCH = { width: 34, height: 20, thumb: 16 };
/** A list of cards sits in a centred column no wider than this (docs/design.md section 7). */
const COLUMN = 720;
/** The scene's floor where its parent gives it no height. A phone on its side leaves about 210. */
const SCENE_MIN_HEIGHT = 160;
/** Room around a focusable row inside a scroller, which would cut its focus ring off. */
const FOCUS_RING = 4;
const DOT = 8;
const DOT_GAP = 12;
/** Where a row's text starts, from the row's own left edge. A child's dot sits on this rail. */
const TEXT_RAIL = DOT + DOT_GAP;

/**
 * Surface styles from the host theme, on the app's scales (docs/design.md): spacing 2, 4, 8, 12,
 * 16, 24; text 14 and 12; weight 500 only where text names a group or a control. `touchScreen` is
 * the device's fact (office-surface.tsx hasTouchScreen); this file asks no platform anything.
 */
export function useOfficeStyles(
  theme: PluginTheme,
  compact: boolean,
  touchScreen: boolean,
): OfficeStyles {
  return useMemo((): OfficeStyles => {
    const { colors } = theme;
    const pad = compact ? 12 : 16;
    // The app's sizing gate (control-sizing.ts resolveControlSizing): touch-sized in the compact
    // layout or on a touch screen, so a tablet with the sidebar docked keeps 44 px controls.
    const touch = compact || touchScreen;
    const controlHeight = touch ? TOUCH_CONTROL : POINTER_CONTROL;
    const base: TextStyle = { fontSize: 14, lineHeight: 20 };
    const small: TextStyle = { fontSize: 12, lineHeight: 16 };
    // The prompt is content text, not chrome: the app's content sizes (docs/design.md section 3).
    // 16 px is also the size below which a phone browser zooms the page when a field takes focus.
    const prompt = touch ? { fontSize: 16, lineHeight: 22 } : { fontSize: 15, lineHeight: 21 };
    // On a phone the column is the screen. On a wide one the header, the banner and the list
    // share it, so they keep one pair of rails.
    const column: ViewStyle = { width: "100%", maxWidth: COLUMN + pad * 2, alignSelf: "center" };
    const dot = (backgroundColor: string): ViewStyle => ({
      width: DOT,
      height: DOT,
      borderRadius: DOT / 2,
      backgroundColor,
    });
    const state = (color: string): TextStyle => ({ ...small, flexShrink: 0, color });
    // The app's secondary button is surface3, which PluginTheme lacks, and the border colour is
    // 1.07 to 1.16:1 against a dark card. A fifth of the muted grey is the light theme's
    // surface3 again (1.28:1) and 1.35 to 1.61:1 in the dark ones. It fills the plain button, and
    // a row or a strip entry under a finger or a pointer, as a layer of its own, so its opacity
    // does not fade what is drawn on it.
    const fill: ViewStyle = {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: colors.foregroundMuted,
      opacity: 0.2,
    };
    // The plain button is filled by buttonFill, a layer inside it; the accent button fills itself.
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
    const chip: ViewStyle = {
      minHeight: controlHeight,
      // A long agent title ends in an ellipsis instead of filling the row.
      maxWidth: 240,
      paddingHorizontal: 16,
      borderRadius: 9999,
      borderWidth: 1,
      borderColor: colors.border,
      justifyContent: "center",
    };
    const row: ViewStyle = {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: DOT_GAP,
      minHeight: TOUCH_CONTROL,
      paddingVertical: 12,
      paddingHorizontal: pad,
    };
    // A child sits closer to its parent than two top-level agents sit to each other.
    const rowChild: ViewStyle = { ...row, paddingVertical: 8, paddingLeft: pad + TEXT_RAIL };
    const control: ViewStyle = {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      minHeight: controlHeight,
    };
    const switchSize = touch ? TOUCH_SWITCH : POINTER_SWITCH;
    // The thumb sits inside the track, at the end the track's alignItems names.
    const track: ViewStyle = {
      width: switchSize.width,
      height: switchSize.height,
      borderRadius: switchSize.height / 2,
      padding: (switchSize.height - switchSize.thumb) / 2,
      justifyContent: "center",
    };
    const thumb: ViewStyle = {
      width: switchSize.thumb,
      height: switchSize.thumb,
      borderRadius: switchSize.thumb / 2,
    };
    const stripItem: ViewStyle = {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
      minHeight: TOUCH_CONTROL,
      maxWidth: 260,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface1,
      // Clips the pressed fill to the rounded corners.
      overflow: "hidden",
    };
    return {
      screen: { flex: 1, backgroundColor: colors.surface0 },
      // No side padding here: the strip scrolls to the screen edge, and each row pads itself.
      header: { paddingTop: 8, gap: 8 },
      // Each control is as tall as a touch target, so the row gap only keeps two targets apart.
      headerControls: {
        ...column,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "flex-end",
        flexWrap: "wrap",
        columnGap: 16,
        rowGap: 4,
        paddingHorizontal: pad,
      },
      headerProblems: { ...column, paddingHorizontal: pad, gap: 4 },
      control,
      controlDisabled: { ...control, opacity: 0.5 },
      controlLabel: { ...base, color: colors.foregroundMuted },
      // An off track in the border colour disappears on a dark surface0, so off is the muted grey:
      // the surface0 thumb then stands 3:1 or more off it in every built-in theme. The thumb on
      // the accent is the accent's own ink, as in the app's switch: 3.1:1 or more in every
      // built-in theme, where surface0 falls to 3.0:1 in the dark one.
      switchOn: { ...track, alignItems: "flex-end", backgroundColor: colors.accent },
      switchOff: {
        ...track,
        alignItems: "flex-start",
        backgroundColor: colors.foregroundMuted,
      },
      switchOnThumb: { ...thumb, backgroundColor: colors.accentForeground },
      switchOffThumb: { ...thumb, backgroundColor: colors.surface0 },
      placeholderColor: colors.foregroundMuted,
      content: { ...column, paddingHorizontal: pad, paddingTop: pad, paddingBottom: 24, gap: 12 },
      muted: { ...base, color: colors.foregroundMuted },
      // A failure above a list that still shows: the app's bordered banner with the sentence in
      // the danger colour (docs/design.md section 11).
      bannerSlot: { ...column, paddingHorizontal: pad, paddingTop: 8 },
      banner: {
        padding: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.border,
        gap: 8,
      },
      bannerText: { ...base, color: colors.statusDanger },
      // On a wide screen the rail gives the scroller the ring's room at each side, so the first
      // and the last entry keep their focus rings and still rest on the cards' rails.
      stripRail: compact ? column : { ...column, paddingHorizontal: pad - FOCUS_RING },
      stripScroll: { width: "100%" },
      // The padding leaves room for an entry's focus ring inside the scroll view. On a phone the
      // side padding puts the entries at rest on the cards' rails.
      strip: {
        gap: 8,
        paddingVertical: FOCUS_RING,
        paddingHorizontal: compact ? pad : FOCUS_RING,
      },
      stripItem,
      // A pressed row or entry keeps its own box: the fill is the pressedFill layer inside it.
      stripItemPressed: stripItem,
      pressedFill: fill,
      stripBody: { flexShrink: 1 },
      stripTitle: { ...base, color: colors.foreground },
      stripReason: {
        permission: { ...small, color: colors.statusWarning },
        error: { ...small, color: colors.statusDanger },
      },
      card: {
        backgroundColor: colors.surface1,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.border,
        overflow: "hidden",
      },
      cardHeader: { paddingVertical: 12, paddingHorizontal: pad, gap: 2 },
      cardTitle: { ...base, color: colors.foreground, fontWeight: "500" },
      cardSubtitle: { ...small, color: colors.foregroundMuted },
      empty: { ...base, color: colors.foregroundMuted, paddingHorizontal: pad, paddingBottom: 12 },
      rowDivider: { borderTopWidth: 1, borderTopColor: colors.border },
      // A child row has 8 px under it and a top-level row 12.
      rowGroupEnd: { paddingBottom: 4 },
      row,
      rowPressed: row,
      rowChild,
      rowChildPressed: rowChild,
      lead: { height: 20, justifyContent: "center" },
      rowBody: { flex: 1, minWidth: 0, gap: 2 },
      rowHeading: { flexDirection: "row", alignItems: "center", gap: 8 },
      // Fills the line, so the state label sits on the row's trailing rail.
      rowTitle: { ...base, flex: 1, color: colors.foreground },
      rowState: {
        running: state(colors.foregroundMuted),
        idle: state(colors.foregroundMuted),
        starting: state(colors.foregroundMuted),
        warning: state(colors.statusWarning),
        danger: state(colors.statusDanger),
      },
      rowMeta: { ...small, color: colors.foregroundMuted },
      rowActivity: { ...small, color: colors.foreground },
      rowPermissions: {
        paddingLeft: pad + TEXT_RAIL,
        paddingRight: pad,
        paddingBottom: 12,
        gap: 12,
      },
      rowChildPermissions: {
        paddingLeft: pad + TEXT_RAIL * 2,
        paddingRight: pad,
        paddingBottom: 8,
        gap: 12,
      },
      permission: { gap: 8 },
      // What the agent asks for is the thing to read before answering, so it is not in the
      // warning colour: the row's dot and its state word already carry that.
      permissionTitle: { ...base, color: colors.foreground },
      actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
      dot: {
        // Not the accent: on the default dark theme that is 2.8:1 against a card, dimmer than idle.
        running: dot(colors.statusSuccess),
        idle: dot(colors.foregroundMuted),
        // A ring, so starting differs from idle by shape as well as by its label.
        starting: {
          width: DOT,
          height: DOT,
          borderRadius: DOT / 2,
          borderWidth: 1.5,
          borderColor: colors.foregroundMuted,
        },
        warning: dot(colors.statusWarning),
        danger: dot(colors.statusDanger),
      },
      // Shrinks with its row, so a long error wraps instead of widening the screen.
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
      buttonPrimaryText: { ...buttonLabel, color: colors.accentForeground },
      // No margin of its own: under a button the wrapper's gap places it, under a row of buttons
      // the block's gap does.
      actionError: { ...small, color: colors.statusDanger },
      sheet: { gap: 16 },
      sheetStatus: { gap: 4 },
      sheetActions: { gap: 8 },
      sheetField: { gap: 8 },
      sheetLabel: { ...base, color: colors.foregroundMuted, fontWeight: "500" },
      sheetText: { ...base, color: colors.foreground },
      // The app's form field (hosts/add-host/internal/add-host-modal.tsx) with its paddings and
      // hairline, three lines tall. The fill is surface1, not that field's surface2: the muted
      // placeholder is 4.39:1 on surface2 in the light theme and 4.63:1 on surface1.
      input: {
        ...prompt,
        minHeight: prompt.lineHeight * 3 + 26,
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface1,
        color: colors.foreground,
        textAlignVertical: "top",
      },
      boardSection: {
        borderTopWidth: 1,
        borderTopColor: colors.border,
        paddingVertical: 12,
        paddingHorizontal: pad,
        gap: 8,
      },
      boardTitleRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      },
      boardHeading: { flexDirection: "row", alignItems: "baseline", gap: 8, flexShrink: 1 },
      boardTitle: { ...small, color: colors.foregroundMuted, fontWeight: "500" },
      // A post and its buttons are one block: closer to each other than to the next post.
      boardPosts: { gap: 16 },
      boardPost: { gap: 8 },
      post: { gap: 4, paddingVertical: 4 },
      postMeta: { ...small, color: colors.foregroundMuted },
      postText: { ...base, color: colors.foreground },
      chips: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
      // The padding leaves room for a chip's focus ring inside the scroller, and the scroller
      // reaches out by as much, so the chips at rest still stand on the sheet's rails.
      chipScroll: { marginHorizontal: -FOCUS_RING },
      chipRow: { flexDirection: "row", alignItems: "center", gap: 8, padding: FOCUS_RING },
      chip,
      // The chosen chip differs by more than tone: its outline is twice as heavy. The padding
      // gives the extra pixel back, so choosing a chip moves nothing.
      chipSelected: {
        ...chip,
        paddingHorizontal: 15,
        borderWidth: 2,
        backgroundColor: colors.surface2,
        borderColor: colors.foregroundMuted,
      },
      chipText: { ...base, color: colors.foregroundMuted },
      chipTextSelected: { ...base, color: colors.foreground },
      scene: { flex: 1, minHeight: SCENE_MIN_HEIGHT },
      sceneStatus: { ...column, ...base, color: colors.foregroundMuted, padding: pad },
    };
  }, [theme, compact, touchScreen]);
}
