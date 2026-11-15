import { memo, useMemo } from "react";
import { View, type ViewStyle } from "react-native";
import type { Sprite } from "./sprite.js";

interface SpriteStyles {
  box: ViewStyle;
  rects: readonly { key: string; style: ViewStyle }[];
}

// A sprite at a scale is drawn by many people and desks: its styles are built once.
const cache = new WeakMap<Sprite, Map<number, SpriteStyles>>();

function spriteStyles(sprite: Sprite, scale: number): SpriteStyles {
  let scales = cache.get(sprite);
  if (scales === undefined) {
    scales = new Map();
    cache.set(sprite, scales);
  }
  let styles = scales.get(scale);
  if (styles === undefined) {
    styles = {
      box: {
        position: "absolute",
        width: sprite.width * scale,
        height: sprite.height * scale,
        pointerEvents: "none",
      },
      rects: sprite.rects.map((rect) => ({
        key: `${rect.x}:${rect.y}`,
        style: {
          position: "absolute",
          left: rect.x * scale,
          top: rect.y * scale,
          width: rect.w * scale,
          height: rect.h * scale,
          backgroundColor: rect.color,
        },
      })),
    };
    scales.set(scale, styles);
  }
  return styles;
}

export interface SpriteViewProps {
  sprite: Sprite;
  /** Screen pixels per art pixel. */
  scale: number;
  /** The top left corner inside the parent, in art pixels. */
  x: number;
  y: number;
}

/**
 * A picture as one view per rectangle of colour. A plugin's client has no canvas and no SVG on a
 * phone, and a scaled image is smoothed there; flat views are sharp on every platform.
 */
export const SpriteView = memo(function SpriteView({ sprite, scale, x, y }: SpriteViewProps) {
  const styles = spriteStyles(sprite, scale);
  const box = useMemo(
    (): ViewStyle => ({ ...styles.box, left: x * scale, top: y * scale }),
    [styles, x, y, scale],
  );
  return (
    <View style={box}>
      {styles.rects.map((rect) => (
        <View key={rect.key} style={rect.style} />
      ))}
    </View>
  );
});
