import { useCallback, type ReactNode } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { Icon } from "@getpaseo/plugin/client/ui";
import type { DesignStyles } from "./styles.js";

/** A round icon button as tall as a control, with the pressed fill as a layer. */
export function IconButton(props: {
  label: string;
  icon: string;
  styles: DesignStyles;
  onPress(): void;
}) {
  const { icon, styles } = props;
  const render = useCallback(
    ({ pressed }: PressableStateCallbackType) => (
      <>
        {pressed ? <View style={styles.buttonFill} /> : null}
        <Icon name={icon} size={18} color={styles.iconColor} />
      </>
    ),
    [icon, styles],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      onPress={props.onPress}
      style={styles.iconButton}
    >
      {render}
    </Pressable>
  );
}

/** A whole-row button: its content on the row's rail, the pressed fill behind it. */
export function PressRow(props: {
  label: string;
  styles: DesignStyles;
  onPress(): void;
  children: ReactNode;
}) {
  const { styles, children } = props;
  const render = useCallback(
    ({ pressed }: PressableStateCallbackType) => (
      <>
        {pressed ? <View style={styles.buttonFill} /> : null}
        {children}
      </>
    ),
    [children, styles],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      onPress={props.onPress}
      style={styles.row}
    >
      {render}
    </Pressable>
  );
}

/** One choice of a radio group; the chosen one has a 2 px outline that does not move it. */
export function Chip(props: {
  id: string;
  label: string;
  chosen: boolean;
  styles: DesignStyles;
  onChoose(id: string): void;
}) {
  const { id, onChoose, styles } = props;
  const press = useCallback(() => onChoose(id), [id, onChoose]);
  const state = props.chosen ? CHECKED : UNCHECKED;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={state}
      onPress={press}
      style={props.chosen ? styles.chipSelected : styles.chip}
    >
      <Text style={styles.chipLabel} numberOfLines={1}>
        {props.label}
      </Text>
    </Pressable>
  );
}

const CHECKED = { checked: true };
const UNCHECKED = { checked: false };
