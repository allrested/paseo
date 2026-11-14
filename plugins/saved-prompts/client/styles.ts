import { useMemo } from "react";
import type { PluginTheme } from "@getpaseo/plugin";

/** The settings screen's own styles, from the host theme. */
export function useScreenStyles(theme: PluginTheme) {
  return useMemo(
    () => ({
      muted: { color: theme.colors.foregroundMuted, paddingHorizontal: 16 },
      error: { color: theme.colors.statusDanger, paddingHorizontal: 16 },
      // SettingsCard has no padding of its own; its rows use 16.
      block: { padding: 16, gap: 8 },
      label: { color: theme.colors.foreground, fontSize: 14 },
      // A web textarea does not grow with its text, so the editor needs its own height.
      editor: {
        minHeight: 160,
        padding: 12,
        borderWidth: 1,
        borderRadius: 8,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface0,
        color: theme.colors.foreground,
        fontSize: 14,
        lineHeight: 20,
        textAlignVertical: "top" as const,
      },
    }),
    [theme],
  );
}

export type ScreenStyles = ReturnType<typeof useScreenStyles>;
