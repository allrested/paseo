import { useCallback } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import type { AndroidStyles } from "./styles.js";

export interface ButtonProps {
  label: string;
  onPress(): void;
  styles: AndroidStyles;
  slot?: boolean;
}

export function Button({ label, onPress, styles, slot = false }: ButtonProps) {
  const style = useCallback(
    ({ pressed }: PressableStateCallbackType) => (pressed ? styles.buttonPressed : styles.button),
    [styles],
  );
  return (
    <View style={slot ? styles.keyButton : undefined}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        style={style}
      >
        <View style={styles.buttonFill} />
        <Text style={styles.buttonText} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
    </View>
  );
}
