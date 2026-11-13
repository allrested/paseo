import { useCallback, useEffect, useRef, useState } from "react";
import {
  Pressable,
  Text,
  View,
  type PressableStateCallbackType,
  type ViewStyle,
} from "react-native";
import type { DesignStyles } from "./styles.js";

// Copied from the office (plugins/office/client/action-button.tsx), with a danger label for the
// confirm step of a removal.

export interface ActionButtonProps {
  label: string;
  /** Shown while the action runs, e.g. "Sending...". */
  pendingLabel: string;
  onPress(): void | Promise<void>;
  styles: DesignStyles;
  primary?: boolean;
  /** Red label: only inside a confirm, once the user asked for the action (docs/design.md). */
  danger?: boolean;
  disabled?: boolean;
}

// Same as server/errors.ts errorMessage; client code may not import server/.
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A label is imperative ("Send"), so its failure reads "Unable to send: ...". A message that
 * already starts "Unable to" (the office board's errors) is shown as it is, not prefixed twice,
 * and an error that says nothing leaves no colon behind.
 */
export function failureText(label: string, error: unknown): string {
  const message = messageOf(error).trim();
  if (message.startsWith("Unable to")) return message;
  const failure = `Unable to ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
  return message === "" ? failure : `${failure}: ${message}`;
}

function buttonStyle(
  styles: DesignStyles,
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
  danger = false,
  disabled = false,
}: ActionButtonProps) {
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
          setError(failureText(label, failure));
        },
      );
  }, [label, onPress]);
  const dim = disabled || pending;
  const style = useCallback(
    ({ pressed }: PressableStateCallbackType) => buttonStyle(styles, primary, dim, pressed),
    [styles, primary, dim],
  );
  const shown = pending ? pendingLabel : label;
  let textStyle = styles.buttonText;
  if (primary) textStyle = styles.buttonPrimaryText;
  else if (danger) textStyle = styles.buttonDangerText;
  return (
    <View style={styles.actionButton}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={shown}
        disabled={dim}
        onPress={press}
        style={style}
      >
        {primary ? null : <View style={styles.buttonFill} />}
        <Text style={textStyle} numberOfLines={1}>
          {shown}
        </Text>
        {/* "Approve" turning into "Approving..." would widen the button and move its neighbour. */}
        <Text aria-hidden style={styles.buttonSpacer} numberOfLines={1}>
          {pending ? label : pendingLabel}
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
