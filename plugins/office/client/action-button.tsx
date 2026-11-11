import { useCallback, useEffect, useRef, useState } from "react";
import {
  Pressable,
  Text,
  View,
  type PressableStateCallbackType,
  type ViewStyle,
} from "react-native";
import type { OfficeStyles } from "./styles.js";

export interface ActionButtonProps {
  label: string;
  /** Shown while the action runs, e.g. "Sending...". */
  pendingLabel: string;
  onPress(): void | Promise<void>;
  styles: OfficeStyles;
  primary?: boolean;
  disabled?: boolean;
}

// Same as server/errors.ts errorMessage; client code may not import server/.
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A label is imperative ("Send"), so its failure reads "Unable to send: ...". */
function failureText(label: string, error: unknown): string {
  return `Unable to ${label.charAt(0).toLowerCase()}${label.slice(1)}: ${messageOf(error)}`;
}

function buttonStyle(
  styles: OfficeStyles,
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

/** A button that shows its own pending state and keeps its error in place (docs/testing.md). */
export function ActionButton({
  label,
  pendingLabel,
  onPress,
  styles,
  primary = false,
  disabled = false,
}: ActionButtonProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const press = useCallback(() => {
    if (pending) return;
    setPending(true);
    setError(null);
    Promise.resolve()
      .then(() => onPress())
      .then(
        () => {
          if (mounted.current) setPending(false);
          return undefined;
        },
        (failure: unknown) => {
          if (!mounted.current) return;
          setPending(false);
          setError(failureText(label, failure));
        },
      );
  }, [label, onPress, pending]);
  const dim = disabled || pending;
  const style = useCallback(
    ({ pressed }: PressableStateCallbackType) => buttonStyle(styles, primary, dim, pressed),
    [styles, primary, dim],
  );
  return (
    <View style={styles.actionButton}>
      <Pressable accessibilityRole="button" disabled={dim} onPress={press} style={style}>
        <Text style={primary ? styles.buttonPrimaryText : styles.buttonText} numberOfLines={1}>
          {pending ? pendingLabel : label}
        </Text>
      </Pressable>
      {error ? (
        <Text accessibilityRole="alert" style={styles.actionError}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
