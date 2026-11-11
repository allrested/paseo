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
  /** Each increment focuses the hidden text field, which raises the on-screen keyboard. */
  keyboardRequest: number;
}
