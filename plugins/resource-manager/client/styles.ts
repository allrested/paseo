import { useMemo } from "react";
import type { TextStyle, ViewStyle } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";

export interface ScreenStyles {
  /** The scroll view's content: padded. */
  content: ViewStyle;
  /** A tab's body inside the content: spaced, not padded again. */
  stack: ViewStyle;
  tabs: ViewStyle;
  tab: ViewStyle;
  tabSelected: ViewStyle;
  tabLabel: TextStyle;
  tabLabelSelected: TextStyle;
  muted: TextStyle;
  error: TextStyle;
}

/** Styles for the Resources screen, from the host theme. Typed, so no `as const` is needed. */
export function useScreenStyles(theme: PluginTheme): ScreenStyles {
  return useMemo(
    (): ScreenStyles => ({
      content: { padding: 16, gap: 16 },
      stack: { gap: 16 },
      tabs: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
      // The plugin UI kit has no SegmentedControl, so a tab is styled like one segment: the selected
      // one gets a quiet fill and foreground text, not an inverted accent fill, and no tab gets a
      // border of its own (docs/design.md sections 3-5). PluginTheme has no surface3, so the fill is
      // surface2, the sidebar's selected-row fill.
      tab: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6 },
      tabSelected: {
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 6,
        backgroundColor: theme.colors.surface2,
      },
      tabLabel: { color: theme.colors.foregroundMuted },
      tabLabelSelected: { color: theme.colors.foreground },
      muted: { color: theme.colors.foregroundMuted },
      error: { color: theme.colors.statusDanger },
    }),
    [theme],
  );
}
