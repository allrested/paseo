import { useMemo } from "react";
import type { PluginFilePanelProps } from "@getpaseo/plugin/client";
import { hasTouchScreen } from "./device.js";
import { useViewerStyles, type ViewerStyles } from "./styles.js";

/** A panel's styles: sized for a finger on a phone's layout and on any touch screen. */
export function usePanelStyles({ theme, layout }: PluginFilePanelProps): ViewerStyles {
  // Asked once for the panel's life, like the app: a mouse plugged into a tablet does not shrink
  // its controls.
  const touchScreen = useMemo(() => hasTouchScreen(layout.platform), [layout.platform]);
  return useViewerStyles(theme, layout.compact || touchScreen);
}
