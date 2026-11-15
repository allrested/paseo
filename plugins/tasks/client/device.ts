import { useCallback, useEffect, useState } from "react";
import type { LayoutChangeEvent } from "react-native";

type Platform = "ios" | "android" | "web";

/**
 * The app's hasTouchScreen (packages/app/src/hooks/pointer-capabilities.ts), which a plugin
 * cannot import: native is always a touch screen, and a browser answers for itself.
 */
export function hasTouchScreen(platform: Platform): boolean {
  if (platform !== "web") return true;
  if (typeof window === "undefined") return false;
  const coarse =
    typeof window.matchMedia === "function" && window.matchMedia("(any-pointer: coarse)").matches;
  return coarse || window.navigator.maxTouchPoints > 0;
}

// "5 min ago" on a screen left open is wrong within the minute.
const TICK_MS = 30_000;

export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** `value` once it has stayed the same for `ms`. */
export function useDebounced<Value>(value: Value, ms: number): Value {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

export interface MeasuredWidth {
  /** Null until the first layout. */
  width: number | null;
  onLayout(event: LayoutChangeEvent): void;
}

/** The width a view is laid out at. `layout.compact` is the window's fact, not the screen's. */
export function useMeasuredWidth(): MeasuredWidth {
  const [width, setWidth] = useState<number | null>(null);
  const onLayout = useCallback(
    (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width),
    [],
  );
  return { width, onLayout };
}
