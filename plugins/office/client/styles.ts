import { useMemo } from "react";
import { Platform, type TextStyle, type ViewStyle } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import type { AttentionReason, DotTone } from "./model.js";

export interface OfficeStyles {
  screen: ViewStyle;
  header: ViewStyle;
  headerRow: ViewStyle;
  headerControls: ViewStyle;
  control: ViewStyle;
  controlDisabled: ViewStyle;
  controlLabel: TextStyle;
  switchTrack: { false: string; true: string };
  switchThumb: string;
  /** The switch the surface draws itself: its track on and off, and the thumb in each. */
  switchOn: ViewStyle;
  switchOff: ViewStyle;
  switchOnThumb: ViewStyle;
  switchOffThumb: ViewStyle;
  placeholderColor: string;
  content: ViewStyle;
  muted: TextStyle;
  error: TextStyle;
  banner: ViewStyle;
  bannerText: TextStyle;
  strip: ViewStyle;
  stripItem: ViewStyle;
  stripItemPressed: ViewStyle;
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
  sheetField: ViewStyle;
  sheetLabel: TextStyle;
  sheetText: TextStyle;
  input: TextStyle;
  boardSection: ViewStyle;
  boardTitleRow: ViewStyle;
  boardTitle: TextStyle;
  post: ViewStyle;
  postMeta: TextStyle;
  postText: TextStyle;
  chips: ViewStyle;
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
const DOT = 8;
const DOT_GAP = 12;
/** Where a row's text starts, from the row's own left edge. A child's dot sits on this rail. */
const TEXT_RAIL = DOT + DOT_GAP;

// Same test as the app's hasTouchScreen (packages/app/src/hooks/pointer-capabilities.ts), which a
// plugin cannot import: native is always a touch screen, a browser answers the media query.
function hasTouchScreen(): boolean {
  if (Platform.OS !== "web") return true;
  if (typeof window === "undefined") return false;
  const coarse =
    typeof window.matchMedia === "function" && window.matchMedia("(any-pointer: coarse)").matches;
  return coarse || window.navigator.maxTouchPoints > 0;
}

/**
 * Surface styles from the host theme, on the app's scales (docs/design.md): spacing 2, 4, 8, 12,
 * 16, 24; text 14 and 12; weight 500 only where text names a group or a control.
 */
export function useOfficeStyles(theme: PluginTheme, compact: boolean): OfficeStyles {
  return useMemo((): OfficeStyles => {
    const { colors } = theme;
    const pad = compact ? 12 : 16;
    // The app's sizing gate (control-sizing.ts resolveControlSizing): touch-sized in the compact
    // layout or on a touch screen, so a tablet with the sidebar docked keeps 44 px controls.
    const touch = compact || hasTouchScreen();
    const controlHeight = touch ? TOUCH_CONTROL : POINTER_CONTROL;
    const base: TextStyle = { fontSize: 14, lineHeight: 20 };
    const small: TextStyle = { fontSize: 12, lineHeight: 16 };
    const dot = (backgroundColor: string): ViewStyle => ({
      width: DOT,
      height: DOT,
      borderRadius: DOT / 2,
      backgroundColor,
    });
    const state = (color: string): TextStyle => ({ ...small, flexShrink: 0, color });
    // PluginTheme has no surface3 or interactionHighlight. The border colour is surface3 in the
    // light theme and sits beside surface2 in the dark ones, so it stands in for both: the fill of
    // the app's secondary button, and a row under a finger. surface2 itself is 1.05:1 against a
    // surface1 card in the light theme, which no one would see.
    const raised = colors.border;
    const button: ViewStyle = {
      minHeight: controlHeight,
      paddingHorizontal: touch ? 24 : 16,
      borderRadius: 9999,
      borderWidth: 1,
      borderColor: raised,
      backgroundColor: raised,
      alignItems: "center",
      justifyContent: "center",
    };
    const buttonPrimary: ViewStyle = {
      ...button,
      backgroundColor: colors.accent,
      borderColor: colors.accent,
    };
    const buttonLabel: TextStyle = { ...base, fontWeight: "500" };
    const chip: ViewStyle = {
      minHeight: controlHeight,
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
    };
    return {
      screen: { flex: 1, backgroundColor: colors.surface0 },
      // No side padding here: the strip scrolls to the screen edge, and each row pads itself.
      header: { paddingTop: 8, gap: 8 },
      headerRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: 16,
        paddingHorizontal: pad,
      },
      headerControls: {
        flexDirection: "row",
        alignItems: "center",
        flexWrap: "wrap",
        columnGap: 16,
        paddingHorizontal: pad,
      },
      control,
      controlDisabled: { ...control, opacity: 0.5 },
      controlLabel: { ...base, color: colors.foregroundMuted },
      // An off track in the border colour disappears on a dark surface0, so off is the muted grey:
      // the surface0 thumb then stands 3:1 or more off both tracks in every built-in theme.
      switchTrack: { false: colors.foregroundMuted, true: colors.accent },
      switchThumb: colors.surface0,
      // The same tracks. The thumb on the accent is the accent's own ink, as in the app's switch:
      // 3.1:1 or more in every built-in theme, where surface0 falls to 3.0:1 in the dark one.
      switchOn: { ...track, alignItems: "flex-end", backgroundColor: colors.accent },
      switchOff: {
        ...track,
        alignItems: "flex-start",
        backgroundColor: colors.foregroundMuted,
      },
      switchOnThumb: { ...thumb, backgroundColor: colors.accentForeground },
      switchOffThumb: { ...thumb, backgroundColor: colors.surface0 },
      placeholderColor: colors.foregroundMuted,
      content: { paddingHorizontal: pad, paddingTop: pad, paddingBottom: 24, gap: 12 },
      muted: { ...base, color: colors.foregroundMuted },
      error: { ...base, color: colors.statusDanger, padding: pad },
      banner: {
        marginHorizontal: pad,
        marginTop: 8,
        padding: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.border,
        gap: 8,
      },
      bannerText: { ...base, color: colors.foreground },
      // The vertical padding leaves room for an entry's focus ring inside the scroll view.
      strip: { gap: 8, paddingVertical: 4, paddingHorizontal: pad },
      stripItem,
      stripItemPressed: { ...stripItem, backgroundColor: raised },
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
      row,
      rowPressed: { ...row, backgroundColor: raised },
      rowChild,
      rowChildPressed: { ...rowChild, backgroundColor: raised },
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
      permissionTitle: { ...base, color: colors.statusWarning },
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
      actionButton: { flexShrink: 1, maxWidth: "100%" },
      button,
      buttonPressed: { ...button, opacity: 0.85 },
      buttonPrimary,
      buttonPrimaryPressed: { ...buttonPrimary, opacity: 0.85 },
      buttonDisabled: { ...button, opacity: 0.5 },
      buttonPrimaryDisabled: { ...buttonPrimary, opacity: 0.5 },
      buttonText: { ...buttonLabel, color: colors.foreground },
      buttonPrimaryText: { ...buttonLabel, color: colors.accentForeground },
      actionError: { ...small, color: colors.statusDanger, marginTop: 4 },
      sheet: { gap: 16 },
      sheetStatus: { gap: 4 },
      sheetField: { gap: 8 },
      sheetLabel: { ...base, color: colors.foregroundMuted, fontWeight: "500" },
      sheetText: { ...base, color: colors.foreground },
      // The app's form field (hosts/add-host/internal/add-host-modal.tsx): a surface2 fill with
      // the border hairline, three lines tall.
      input: {
        ...base,
        minHeight: 88,
        paddingVertical: 12,
        paddingHorizontal: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface2,
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
      boardTitle: { ...small, color: colors.foregroundMuted, fontWeight: "500" },
      post: { gap: 4, paddingVertical: 4 },
      postMeta: { ...small, color: colors.foregroundMuted },
      postText: { ...base, color: colors.foreground },
      chips: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
      chip,
      chipSelected: {
        ...chip,
        backgroundColor: colors.surface2,
        borderColor: colors.foregroundMuted,
      },
      chipText: { ...base, color: colors.foregroundMuted },
      chipTextSelected: { ...base, color: colors.foreground },
      scene: { flex: 1, minHeight: 240 },
      sceneStatus: { ...base, color: colors.foregroundMuted, padding: pad },
    };
  }, [theme, compact]);
}
