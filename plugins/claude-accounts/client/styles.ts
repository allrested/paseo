import { useMemo } from "react";
import type { PluginTheme } from "@getpaseo/plugin";

/** Styles the accounts screen uses, derived from the host theme. */
export function useScreenStyles(theme: PluginTheme) {
  return useMemo(
    () => ({
      // A plugin screen's body is a plain View, so the screen scrolls and pads itself.
      content: {
        padding: 16,
        gap: 24,
        width: "100%" as const,
        maxWidth: 720,
        alignSelf: "center" as const,
      },
      text: { color: theme.colors.foreground },
      muted: { color: theme.colors.foregroundMuted },
      warning: { color: theme.colors.statusWarning },
      error: { color: theme.colors.statusDanger },
    }),
    [theme],
  );
}

export type ScreenStyles = ReturnType<typeof useScreenStyles>;
