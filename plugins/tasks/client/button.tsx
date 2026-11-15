import { useCallback, useEffect, useRef, useState } from "react";
import {
  Pressable,
  Text,
  View,
  type PressableStateCallbackType,
  type ViewStyle,
} from "react-native";
import type { TasksStyles } from "./tasks-styles.js";

export interface ButtonProps {
  label: string;
  /** Shown while the action runs, such as "Posting...". Absent for an action that ends at once. */
  pendingLabel?: string;
  onPress(): void | Promise<void>;
  styles: TasksStyles;
  primary?: boolean;
  disabled?: boolean;
}

function boxStyle(
  styles: TasksStyles,
  primary: boolean,
  dim: boolean,
  pressed: boolean,
): ViewStyle {
  if (primary) {
    if (dim) return styles.buttonPrimaryDisabled;
    return pressed ? styles.buttonPrimaryPressed : styles.buttonPrimary;
  }
  if (dim) return styles.buttonDisabled;
  return pressed ? styles.buttonPressed : styles.button;
}

/**
 * The plugin kit has no button, so this is the app's pill: it shows its own pending state and
 * keeps a failure under itself, in the words it was rejected with.
 */
export function Button({
  label,
  pendingLabel,
  onPress,
  styles,
  primary = false,
  disabled = false,
}: ButtonProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  // Set before the first await, so a second tap before the re-render cannot fire twice.
  const inFlight = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const press = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    Promise.resolve()
      .then(() => onPress())
      .then(
        () => {
          inFlight.current = false;
          if (mounted.current) setPending(false);
          return undefined;
        },
        (failure: unknown) => {
          inFlight.current = false;
          if (!mounted.current) return;
          setPending(false);
          setError(failure instanceof Error ? failure.message : String(failure));
        },
      );
  }, [onPress]);
  const dim = disabled || pending;
  const style = useCallback(
    ({ pressed }: PressableStateCallbackType) => boxStyle(styles, primary, dim, pressed),
    [styles, primary, dim],
  );
  const shown = pending && pendingLabel !== undefined ? pendingLabel : label;
  return (
    <View style={styles.buttonBox}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={shown}
        disabled={dim}
        onPress={press}
        style={style}
      >
        {primary ? null : <View style={styles.buttonFill} />}
        <Text style={primary ? styles.buttonPrimaryText : styles.buttonText} numberOfLines={1}>
          {shown}
        </Text>
        {/* "Post comment" turning into "Posting..." would change the button's width. */}
        {pendingLabel === undefined ? null : (
          <Text aria-hidden style={styles.buttonSpacer} numberOfLines={1}>
            {pending ? label : pendingLabel}
          </Text>
        )}
      </Pressable>
      {error === null ? null : (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </View>
  );
}
