import { useMemo } from "react";
import { Image } from "react-native";
import { Buffer } from "buffer";
import type { FrameRect } from "./view-model";

/** Native: one JPEG frame as a data URI. fadeDuration 0 stops Android cross-fading every frame. */
export function CdpFrameImage({ jpeg, rect }: { jpeg: Uint8Array; rect: FrameRect }) {
  const source = useMemo(
    () => ({ uri: `data:image/jpeg;base64,${Buffer.from(jpeg).toString("base64")}` }),
    [jpeg],
  );
  const style = useMemo(
    () => ({
      position: "absolute" as const,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    }),
    [rect.left, rect.top, rect.width, rect.height],
  );
  return <Image accessibilityIgnoresInvertColors fadeDuration={0} source={source} style={style} />;
}
