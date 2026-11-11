import { useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import {
  View,
  type GestureResponderEvent,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { EditingTextInput, type EditingTextInputHandle } from "@/components/ui/text-input";
import type { CdpInputLayerProps } from "./input-layer-types";
import { createInputCoalescer, createTouchGesture } from "./touch-gesture";
import { toPagePoint } from "./view-model";

/**
 * Touch on the frame is a tap (click) or a drag (scroll). A hidden text input raises the
 * keyboard: typed text goes to the page, Enter and Backspace go as keys. The input is emptied
 * after every change, so Backspace has nothing to delete and arrives only as a key press.
 */
export function CdpInputLayer({
  rect,
  page,
  onInput,
  onFocusPane,
  keyboardRef,
  onKeyboardChange,
}: CdpInputLayerProps) {
  const input = useRef<EditingTextInputHandle>(null);
  const gesture = useRef(createTouchGesture());
  const latestOnInput = useRef(onInput);
  latestOnInput.current = onInput;
  const coalescer = useMemo(() => createInputCoalescer((next) => latestOnInput.current(next)), []);
  useEffect(() => () => coalescer.dispose(), [coalescer]);

  // Taps on the frame do not blur a native input, so the keyboard stays up until the button
  // turns it off or another input (the URL field) takes focus.
  const keyboardOn = useRef(false);
  const latestOnKeyboardChange = useRef(onKeyboardChange);
  latestOnKeyboardChange.current = onKeyboardChange;
  useImperativeHandle(
    keyboardRef,
    () => ({
      show() {
        input.current?.focus();
        keyboardOn.current = true;
        latestOnKeyboardChange.current(true);
      },
      hide() {
        keyboardOn.current = false;
        input.current?.blur();
        latestOnKeyboardChange.current(false);
      },
      isOn: () => keyboardOn.current,
    }),
    [],
  );
  const handleBlur = useCallback(() => {
    if (!keyboardOn.current) return;
    keyboardOn.current = false;
    latestOnKeyboardChange.current(false);
  }, []);

  const point = useCallback(
    (event: GestureResponderEvent) =>
      toPagePoint(
        { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY },
        { width: rect.width, height: rect.height },
        page,
      ),
    [page, rect.height, rect.width],
  );
  const claim = useCallback(() => true, []);
  const handleGrant = useCallback(
    (event: GestureResponderEvent) => {
      onFocusPane?.();
      gesture.current.start(point(event));
    },
    [onFocusPane, point],
  );
  const handleMove = useCallback(
    (event: GestureResponderEvent) => {
      for (const next of gesture.current.move(point(event))) coalescer.push(next);
    },
    [coalescer, point],
  );
  const handleRelease = useCallback(() => {
    for (const next of gesture.current.end()) coalescer.push(next);
  }, [coalescer]);
  const handleTerminate = useCallback(() => gesture.current.cancel(), []);

  const sendKey = useCallback(
    (key: "Enter" | "Backspace") => {
      coalescer.push({ kind: "key", type: "down", key, code: key, modifiers: 0 });
      coalescer.push({ kind: "key", type: "up", key, code: key, modifiers: 0 });
    },
    [coalescer],
  );
  const handleChangeText = useCallback(
    (value: string) => {
      // A multiline field puts "\n" in the text; Enter goes only through onKeyPress.
      const typed = value.replaceAll("\n", "");
      if (typed) coalescer.push({ kind: "text", text: typed });
      // reset() would remount the native input on every key; replacing the text keeps it mounted.
      // Clearing may report "" back on Android, which sends nothing and clears nothing again.
      if (value) input.current?.replaceText("");
    },
    [coalescer],
  );
  const handleKeyPress = useCallback(
    (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      const { key } = event.nativeEvent;
      if (key === "Enter" || key === "Backspace") sendKey(key);
    },
    [sendKey],
  );

  const layerStyle = useMemo(
    () => [
      styles.layer,
      { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    ],
    [rect.left, rect.top, rect.width, rect.height],
  );

  return (
    <>
      <View
        onMoveShouldSetResponder={claim}
        onResponderGrant={handleGrant}
        onResponderMove={handleMove}
        onResponderRelease={handleRelease}
        onResponderTerminate={handleTerminate}
        onStartShouldSetResponder={claim}
        style={layerStyle}
      />
      <EditingTextInput
        ref={input}
        autoCapitalize="none"
        autoCorrect={false}
        blurOnSubmit={false}
        caretHidden
        multiline
        onBlur={handleBlur}
        onChangeText={handleChangeText}
        onKeyPress={handleKeyPress}
        style={styles.hiddenInput}
      />
    </>
  );
}

const styles = StyleSheet.create(() => ({
  layer: {
    position: "absolute",
  },
  hiddenInput: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
  },
}));
