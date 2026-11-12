import { useCallback, useEffect, useId } from "react";
import { Pressable, Text, View } from "react-native";
import { listenForSpace } from "./scene/web-env.web.js";
import type { OfficeStyles } from "./styles.js";

export interface LabeledSwitchProps {
  label: string;
  /** A few words after the label, inside the target, so they read as this switch's and not the next one's. */
  note?: string | null;
  /** Null while its value is being read: drawn on, the default, and not yet usable. */
  value: boolean | null;
  onChange(next: boolean): void;
  styles: OfficeStyles;
}

/**
 * Drawn here, with the role, state and sizes of the app's switch
 * (packages/app/src/components/ui/switch.tsx). A plugin can render that switch through
 * SettingsSwitch (@getpaseo/plugin/client/ui), and it follows the theme with a 44 x 44 target,
 * but only as a settings row: 16 px of padding on every side, the label outside the target and,
 * on a phone, stacked over the switch. In this header at 390 px wide that row measured 104 px
 * tall. Here the label is inside the target, so the row is 44 px tall on a touch screen, says
 * what it turns, and has room for more controls beside it. react-native's Switch is 40 x 20 on
 * web whatever the pointer, and its thumb is a fixed teal while on.
 */
export function LabeledSwitch({ label, note, value, onChange, styles }: LabeledSwitchProps) {
  const on = value ?? true;
  const disabled = value === null;
  const flip = useCallback(() => onChange(!on), [onChange, on]);
  // Enter presses any Pressable; Space, the key that turns a switch, only a button.
  const id = useId();
  useEffect(() => (disabled ? undefined : listenForSpace(id, flip)), [id, flip, disabled]);
  return (
    <Pressable
      id={id}
      accessibilityRole="switch"
      accessibilityLabel={note ? `${label}, ${note}` : label}
      aria-checked={on}
      disabled={disabled}
      onPress={flip}
      style={disabled ? styles.controlDisabled : styles.control}
    >
      <Text style={styles.controlLabel}>{note ? `${label} · ${note}` : label}</Text>
      <View style={on ? styles.switchOn : styles.switchOff}>
        <View style={on ? styles.switchOnThumb : styles.switchOffThumb} />
      </View>
    </Pressable>
  );
}
