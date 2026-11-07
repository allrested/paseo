import { useMemo } from "react";
import { Platform } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";

const MONOSPACE = Platform.select({ ios: "Menlo", default: "monospace" });

/** The workflow card's styles, derived from the host theme. */
export function useCardStyles(theme: PluginTheme) {
  return useMemo(() => {
    const { colors } = theme;
    return {
      card: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12, gap: 12 },
      header: { gap: 4 },
      titleRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
      title: { color: colors.foreground, fontSize: 14, fontWeight: "500" as const },
      runId: { color: colors.foregroundMuted, fontFamily: MONOSPACE, fontSize: 12 },
      // StatusBadge's pill (packages/app/src/components/ui/status-badge.tsx) on surface2, since
      // PluginTheme has no surface3 and no tints.
      chip: {
        marginLeft: "auto" as const,
        borderRadius: 9999,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface2,
        paddingHorizontal: 8,
        paddingVertical: 3,
      },
      chipText: {
        running: { color: colors.accent, fontSize: 12 },
        completed: { color: colors.statusSuccess, fontSize: 12 },
        killed: { color: colors.statusWarning, fontSize: 12 },
        stopped: { color: colors.statusDanger, fontSize: 12 },
        unavailable: { color: colors.foregroundMuted, fontSize: 12 },
      },
      summary: { color: colors.foreground, fontSize: 14 },
      meta: { color: colors.foregroundMuted, fontSize: 12 },
      error: { color: colors.statusDanger, fontSize: 12 },
      body: { gap: 12 },
      phase: { gap: 6 },
      phaseTitle: { color: colors.foregroundMuted, fontSize: 12, fontWeight: "500" as const },
      agent: { gap: 2 },
      agentTitleRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
      agentState: {
        running: { color: colors.accent, fontSize: 12 },
        done: { color: colors.statusSuccess, fontSize: 12 },
        failed: { color: colors.statusDanger, fontSize: 12 },
        stopped: { color: colors.statusWarning, fontSize: 12 },
        unreadable: { color: colors.foregroundMuted, fontSize: 12 },
      },
      agentLabel: { flexShrink: 1, color: colors.foreground, fontSize: 14 },
    };
  }, [theme]);
}

export type CardStyles = ReturnType<typeof useCardStyles>;
