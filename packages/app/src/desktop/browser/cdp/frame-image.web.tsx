import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import type { FrameRect } from "./view-model";

/** Draws one JPEG frame. An <img> with an object URL swaps frames without the flash a data URI gives. */
export function CdpFrameImage({ jpeg, rect }: { jpeg: Uint8Array; rect: FrameRect }) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const url = URL.createObjectURL(new Blob([jpeg.slice().buffer], { type: "image/jpeg" }));
    if (ref.current) ref.current.src = url;
    // The decoded frame stays on screen after its URL is revoked.
    return () => URL.revokeObjectURL(url);
  }, [jpeg]);
  const style = useMemo<CSSProperties>(
    () => ({
      position: "absolute",
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      userSelect: "none",
      pointerEvents: "none",
    }),
    [rect.left, rect.top, rect.width, rect.height],
  );
  return <img ref={ref} alt="" draggable={false} style={style} />;
}
