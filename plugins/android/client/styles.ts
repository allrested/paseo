import { useMemo } from "react";
import type { TextStyle, ViewStyle } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";

export interface AndroidStyles {
  screen: ViewStyle;
  /** The row of switches: it wraps on a phone. */
  header: ViewStyle;
  control: ViewStyle;
  controlDisabled: ViewStyle;
  controlLabel: TextStyle;
  switchOn: ViewStyle;
  switchOff: ViewStyle;
  switchOnThumb: ViewStyle;
  switchOffThumb: ViewStyle;
  placeholderColor: string;
  status: TextStyle;
  banner: ViewStyle;
  bannerSlot: ViewStyle;
  bannerText: TextStyle;
  actions: ViewStyle;
  /** The device picture's area and the view that takes its touches. */
  stage: ViewStyle;
  touch: ViewStyle;
  picture: { width: "100%"; height: "100%" };
  keys: ViewStyle;
  keyButton: ViewStyle;
  button: ViewStyle;
  /** The plain button's fill: a layer of its own, so its opacity does not fade the label. */
  buttonFill: ViewStyle;
  buttonPressed: ViewStyle;
  buttonText: TextStyle;
  textRow: ViewStyle;
  input: TextStyle;
  inputSlot: ViewStyle;
  refused: TextStyle;
}

// The app's touch control and switch sizes (packages/app/src/components/ui/control-geometry.ts).
// A panel that mirrors a phone is used with a finger on a phone and with a mouse on a desktop;
// it keeps the touch size on both, and asks the platform nothing.
const CONTROL = 44;
const SWITCH = { width: 44, height: 26, thumb: 22 };
const COLUMN = 720;

/** Panel styles from the host theme, on the app's scales (docs/design.md): spacing 4, 8, 12; text 14. */
export function useAndroidStyles(theme: PluginTheme, compact: boolean): AndroidStyles {
  return useMemo((): AndroidStyles => {
    const { colors } = theme;
    const pad = compact ? 12 : 16;
    const base: TextStyle = { fontSize: 14, lineHeight: 20 };
    const column: ViewStyle = { width: "100%", maxWidth: COLUMN + pad * 2, alignSelf: "center" };
    const button: ViewStyle = {
      minHeight: CONTROL,
      paddingHorizontal: 24,
      borderRadius: 9999,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
    };
    const control: ViewStyle = {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      minHeight: CONTROL,
    };
    const track: ViewStyle = {
      width: SWITCH.width,
      height: SWITCH.height,
      borderRadius: SWITCH.height / 2,
      padding: (SWITCH.height - SWITCH.thumb) / 2,
      justifyContent: "center",
    };
    const thumb: ViewStyle = {
      width: SWITCH.thumb,
      height: SWITCH.thumb,
      borderRadius: SWITCH.thumb / 2,
    };
    return {
      screen: { flex: 1, backgroundColor: colors.surface0 },
      header: {
        ...column,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "flex-end",
        flexWrap: "wrap",
        paddingTop: 8,
        paddingHorizontal: pad,
      },
      control,
      controlDisabled: { ...control, opacity: 0.5 },
      controlLabel: { ...base, color: colors.foregroundMuted },
      switchOn: { ...track, alignItems: "flex-end", backgroundColor: colors.accent },
      switchOff: {
        ...track,
        alignItems: "flex-start",
        backgroundColor: colors.foregroundMuted,
      },
      switchOnThumb: { ...thumb, backgroundColor: colors.accentForeground },
      switchOffThumb: { ...thumb, backgroundColor: colors.surface0 },
      placeholderColor: colors.foregroundMuted,
      status: { ...column, ...base, color: colors.foregroundMuted, padding: pad },
      bannerSlot: { ...column, paddingHorizontal: pad, paddingTop: 8 },
      banner: {
        padding: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.border,
        gap: 8,
      },
      bannerText: { ...base, color: colors.statusDanger },
      actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
      stage: { flex: 1, minHeight: 160, margin: pad, marginBottom: 8 },
      touch: { flex: 1 },
      picture: { width: "100%", height: "100%" },
      keys: { ...column, flexDirection: "row", gap: 8, paddingHorizontal: pad },
      keyButton: { flex: 1 },
      button,
      buttonFill: {
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        backgroundColor: colors.foregroundMuted,
        opacity: 0.2,
      },
      buttonPressed: { ...button, opacity: 0.85 },
      buttonText: { ...base, fontWeight: "500", color: colors.foreground },
      textRow: {
        ...column,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        padding: pad,
      },
      inputSlot: { flex: 1 },
      // The app's form field (hosts/add-host/internal/add-host-modal.tsx), one line tall.
      input: {
        fontSize: 16,
        lineHeight: 22,
        minHeight: CONTROL,
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface1,
        color: colors.foreground,
      },
      refused: { ...column, ...base, color: colors.statusDanger, paddingHorizontal: pad },
    };
  }, [theme, compact]);
}
