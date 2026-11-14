import { useMemo } from "react";
import type { TextStyle, ViewStyle } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";

export interface SearchStyles {
  /** The scroll view's content: padded. */
  content: ViewStyle;
  field: TextStyle;
  placeholderColor: string;
  muted: TextStyle;
  error: TextStyle;
  overview: TextStyle;
  section: ViewStyle;
  sectionTitle: TextStyle;
  card: ViewStyle;
  cardHead: ViewStyle;
  iconColor: string;
  cardTitle: TextStyle;
  cardMeta: TextStyle;
  snippet: TextStyle;
  snippetRole: TextStyle;
  match: TextStyle;
}

/** Styles for the Search chats screen, from the host theme. */
export function useSearchStyles(theme: PluginTheme): SearchStyles {
  return useMemo((): SearchStyles => {
    const { colors } = theme;
    return {
      content: { padding: 16, gap: 16 },
      // 44px tall: the one control on the screen a thumb has to hit first.
      field: {
        minHeight: 44,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderWidth: 1,
        borderRadius: 8,
        borderColor: colors.border,
        backgroundColor: colors.surface0,
        color: colors.foreground,
        fontSize: 16,
      },
      placeholderColor: colors.foregroundMuted,
      muted: { color: colors.foregroundMuted, fontSize: 14, lineHeight: 20 },
      error: { color: colors.statusDanger, fontSize: 14, lineHeight: 20 },
      overview: { color: colors.foreground, fontSize: 14 },
      section: { gap: 8 },
      sectionTitle: { color: colors.foregroundMuted, fontSize: 12, fontWeight: "500" },
      card: {
        padding: 12,
        gap: 6,
        borderWidth: 1,
        borderRadius: 8,
        borderColor: colors.border,
        backgroundColor: colors.surface1,
      },
      cardHead: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
      iconColor: colors.foregroundMuted,
      cardTitle: { flex: 1, color: colors.foreground, fontSize: 14, fontWeight: "500" },
      cardMeta: { color: colors.foregroundMuted, fontSize: 12 },
      snippet: { color: colors.foregroundMuted, fontSize: 13, lineHeight: 18 },
      snippetRole: { color: colors.foregroundMuted, fontWeight: "500" },
      // The words are the one thing in a snippet at full strength.
      match: { color: colors.foreground, fontWeight: "600" },
    };
  }, [theme]);
}
