import type { ForwardRefExoticComponent, RefAttributes } from "react";
import * as kit from "@getpaseo/plugin/client/ui";

export interface ScriptFrameProps {
  /** JavaScript run once, in an empty standards-mode page with no network. */
  script: string;
  /** Text the page sent with `window.paseoFrame.post(text)`. */
  onMessage(text: string): void;
  /** The script threw, or the page could not start. */
  onError?(message: string): void;
  /** What a screen reader calls the frame. */
  title: string;
  testID?: string;
}

export interface ScriptFrameHandle {
  /** Sends text to `window.paseoFrame.onMessage`. Posts made before the page is ready wait, in order. */
  post(text: string): void;
}

/**
 * The fork's kit has `ScriptFrame`; the published one does not declare it, so it is read through
 * a view of the kit that does.
 */
type KitScriptFrame = ForwardRefExoticComponent<
  ScriptFrameProps & RefAttributes<ScriptFrameHandle>
>;

const extras = kit as unknown as { ScriptFrame?: KitScriptFrame };

/**
 * Whether this app's kit has `ScriptFrame`. The store build does not, whatever its version, and
 * the key is absent there. Ask with `in`, never by reading the property.
 */
export function hasScriptFrame(): boolean {
  return "ScriptFrame" in kit;
}

export function kitScriptFrame(): KitScriptFrame | null {
  return "ScriptFrame" in kit ? (extras.ScriptFrame ?? null) : null;
}
