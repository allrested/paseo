import type { ForwardRefExoticComponent, RefAttributes } from "react";
import * as kit from "@getpaseo/plugin/client/ui";
import type { ScriptFrameHandle, ScriptFrameProps } from "@getpaseo/plugin/client/ui";

type KitScriptFrame = ForwardRefExoticComponent<
  ScriptFrameProps & RefAttributes<ScriptFrameHandle>
>;

/**
 * Whether this app's kit has `ScriptFrame`. The store app and apps older than 0.16.0 do not, and
 * the key is absent there. Ask with `in`, never by reading the property.
 */
export function hasScriptFrame(): boolean {
  return "ScriptFrame" in kit;
}

export function kitScriptFrame(): KitScriptFrame | null {
  return "ScriptFrame" in kit ? kit.ScriptFrame : null;
}
