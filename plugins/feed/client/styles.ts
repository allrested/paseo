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

/** Styles for the Feed screen, from the host theme. Sizes follow the Search chats screen. */
export function useFeedStyles(theme: PluginTheme): FeedStyles {
  return useMemo((): FeedStyles => {
    const { colors } = theme;
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
        gap: 8,
        padding: 12,
        borderWidth: 1,
        borderRadius: 8,
        borderColor: colors.border,
        backgroundColor: colors.surface1,
      },
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
  }, [theme]);
}
