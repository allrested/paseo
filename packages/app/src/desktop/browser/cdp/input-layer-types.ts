import type { CdpBrowserViewInput } from "@getpaseo/protocol/browser-automation/cdp-view-schemas";
import type { FrameRect, Size } from "./view-model";

export interface CdpInputLayerProps {
  /** Where the frame is drawn in the pane. The layer covers exactly this rectangle. */
  rect: FrameRect;
  /** The page viewport in CSS pixels, from the frame's metadata. */
  page: Size;
  onInput(input: CdpBrowserViewInput): void;
  onFocusUrl(): void;
  onFocusPane?: () => void;
  /** Native: each increment focuses the hidden text input, which raises the keyboard. */
  keyboardRequest: number;
}
