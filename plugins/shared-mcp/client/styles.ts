import { useMemo } from "react";
import { Platform } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";

const MONOSPACE = Platform.select({ ios: "Menlo", default: "monospace" });

/** Styles both settings screens share, derived from the host theme. */
export function useScreenStyles(theme: PluginTheme) {
  return useMemo(
    () => ({
      muted: { color: theme.colors.foregroundMuted },
      error: { color: theme.colors.statusDanger },
      // SettingsCard has no padding of its own; its rows use 16.
      block: { padding: 16, gap: 8 },
      log: { color: theme.colors.foregroundMuted, fontFamily: MONOSPACE, fontSize: 12 },
      // A web textarea does not grow with its text, so the editor needs its own height.
      editor: {
        minHeight: 320,
        padding: 12,
        borderWidth: 1,
        borderRadius: 8,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface0,
        color: theme.colors.foreground,
        fontFamily: MONOSPACE,
        fontSize: 12,
        textAlignVertical: "top" as const,
      },
    }),
    [theme],
  );
}

export type ScreenStyles = ReturnType<typeof useScreenStyles>;
