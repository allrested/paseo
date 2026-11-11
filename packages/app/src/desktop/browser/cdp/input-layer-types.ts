import type { RefObject } from "react";
import type { CdpBrowserViewInput } from "@getpaseo/protocol/browser-automation/cdp-view-schemas";
import type { FrameRect, Size } from "./view-model";

/** The on-screen keyboard of the input layer, driven by the toolbar's keyboard button. */
export interface CdpKeyboardHandle {
  /** Focuses the hidden text field. Call it inside the press, which iOS needs to raise the keyboard. */
  show(): void;
  hide(): void;
  isOn(): boolean;
}

export interface CdpInputLayerProps {
  /** Where the frame is drawn in the pane. The layer covers exactly this rectangle. */
  rect: FrameRect;
  /** The page viewport in CSS pixels, from the frame's metadata. */
  page: Size;
  onInput(input: CdpBrowserViewInput): void;
  onFocusUrl(): void;
  onFocusPane?: () => void;
  keyboardRef: RefObject<CdpKeyboardHandle | null>;
  /** The keyboard turned on or off, by the button or by the field gaining or losing focus. */
  onKeyboardChange(on: boolean): void;
}
