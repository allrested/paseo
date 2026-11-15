import { useMemo } from "react";
import type { PluginTheme } from "@getpaseo/plugin";

/** The connections screen's own styles, from the host theme. */
export function useScreenStyles(theme: PluginTheme) {
  return useMemo(
    () => ({
      muted: { color: theme.colors.foregroundMuted, paddingHorizontal: 16 },
      error: { color: theme.colors.statusDanger, paddingHorizontal: 16 },
    }),
    [theme],
  );
}

export type ScreenStyles = ReturnType<typeof useScreenStyles>;
