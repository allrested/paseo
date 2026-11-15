import { useMemo } from "react";
import type { TextStyle, ViewStyle } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import type { FeedKind } from "../shared/contracts.js";

export interface FeedStyles {
  /** Fills the screen, so a press anywhere on it is a press on the feed. */
  screen: ViewStyle;
  /** The scroll view's content: padded. */
  content: ViewStyle;
  muted: TextStyle;
  error: TextStyle;
  section: ViewStyle;
  sectionTitle: TextStyle;
  card: ViewStyle;
  /** The part of a card that opens the agent: everything but the mark button. */
  cardMain: ViewStyle;
  /** Marks an entry unread or read; a finger-sized target where a finger drives it. */
  mark: ViewStyle;
  markPressed: ViewStyle;
  /** The mark of an entry that is kept unread. */
  markedColor: string;
  filter: TextStyle;
  placeholderColor: string;
  runningColor: string;
  runningLabel: TextStyle;
  /** Holds the kind's icon on the title's first line. */
  cardIcon: ViewStyle;
  cardBody: ViewStyle;
  cardTitle: TextStyle;
  cardMeta: TextStyle;
  cardText: TextStyle;
  iconColor: string;
  kindColor: Record<FeedKind, string>;
  kindLabel: Record<FeedKind, TextStyle>;
}

// docs/design.md section 4: a control is 44 tall where a finger drives it and 32 under a pointer.
const TOUCH_CONTROL = 44;
const POINTER_CONTROL = 32;

/**
 * Styles for the Feed screen, from the host theme. Sizes follow the Search chats screen. `touch`
 * is true where a finger drives the screen.
 */
export function useFeedStyles(theme: PluginTheme, touch: boolean): FeedStyles {
  return useMemo((): FeedStyles => {
    const { colors } = theme;
    const control = touch ? TOUCH_CONTROL : POINTER_CONTROL;
    const mark: ViewStyle = {
      width: control,
      height: control,
      // The card's padding is 12: the button's ink sits on the card's edge, not its box.
      margin: touch ? -8 : -4,
      borderRadius: 9999,
      alignItems: "center",
      justifyContent: "center",
    };
    // A finished turn is the common case and stays quiet; the two that want the user carry color,
    // and every one is also named in words.
    const kindColor: Record<FeedKind, string> = {
      finished: colors.foregroundMuted,
      failed: colors.statusDanger,
      permission: colors.statusWarning,
    };
    const kindLabel = (kind: FeedKind): TextStyle => ({
      color: kindColor[kind],
      fontWeight: "500",
    });
    return {
      screen: { flex: 1 },
      content: { padding: 16, gap: 16 },
      muted: { color: colors.foregroundMuted, fontSize: 14, lineHeight: 20 },
      error: { color: colors.statusDanger, fontSize: 14, lineHeight: 20 },
      section: { gap: 8 },
      sectionTitle: { color: colors.foregroundMuted, fontSize: 12, fontWeight: "500" },
      card: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 12,
        padding: 12,
        borderWidth: 1,
        borderRadius: 8,
        borderColor: colors.border,
        backgroundColor: colors.surface1,
      },
      cardMain: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "flex-start", gap: 8 },
      mark,
      markPressed: { ...mark, opacity: 0.6 },
      markedColor: colors.accent,
      filter: {
        // 16 px is the size below which a phone browser zooms the page when a field takes focus.
        fontSize: touch ? 16 : 14,
        lineHeight: touch ? 22 : 20,
        height: control,
        paddingVertical: 0,
        paddingHorizontal: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface1,
        color: colors.foreground,
      },
      placeholderColor: colors.foregroundMuted,
      runningColor: colors.statusSuccess,
      runningLabel: { color: colors.statusSuccess, fontWeight: "500" },
      // The title's line is 20 tall and the icon 16.
      cardIcon: { paddingTop: 2 },
      cardBody: { flex: 1, minWidth: 0, gap: 4 },
      cardTitle: { color: colors.foreground, fontSize: 14, lineHeight: 20, fontWeight: "500" },
      cardMeta: { color: colors.foregroundMuted, fontSize: 12, lineHeight: 16 },
      cardText: { color: colors.foregroundMuted, fontSize: 13, lineHeight: 18 },
      iconColor: colors.foregroundMuted,
      kindColor,
      kindLabel: {
        finished: kindLabel("finished"),
        failed: kindLabel("failed"),
        permission: kindLabel("permission"),
      },
    };
  }, [theme, touch]);
}
