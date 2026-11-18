import type { PluginSurfaceProps } from "@getpaseo/plugin/client";

/** What the fork's app can show beside a plugin's screen; stock Paseo's app has no side area. */
export type BesideTarget =
  | { readonly kind: "agent"; readonly agentId: string; readonly serverId?: string }
  | {
      readonly kind: "screen";
      readonly pluginId: string;
      readonly screenId: string;
      readonly params?: Record<string, string>;
      readonly serverId?: string;
    };

type Navigation = PluginSurfaceProps["navigation"];

/** The app's `showBeside`, where it has one; the published types do not declare it. */
export function showBesideOf(navigation: Navigation): ((target: BesideTarget) => boolean) | null {
  const call: unknown = (navigation as Record<string, unknown> | undefined)?.showBeside;
  return typeof call === "function" ? (call as (target: BesideTarget) => boolean) : null;
}

const RESOURCES: BesideTarget = {
  kind: "screen",
  pluginId: "resource-manager",
  screenId: "resources",
};

/**
 * Opens an agent's session beside the office's floor, or in its workspace (which leaves the
 * office) on an app without a side area or when the side area cannot show it. True when the
 * session is beside the floor, so the caller knows the office is still on screen.
 */
export function openSessionWith(navigation: Navigation, agentId: string): boolean {
  if (navigation === undefined) return false;
  if (showBesideOf(navigation)?.({ kind: "agent", agentId }) === true) return true;
  navigation.openAgent({ agentId });
  return false;
}

/**
 * What the server room's wall screen opens: Resources beside the floor, or the Host card when
 * the side area cannot show it. Undefined on an app without a side area, where the scene keeps
 * the wall screen on the Host card.
 */
export function resourcesOpener(
  navigation: Navigation,
  openMachine: () => void,
): (() => void) | undefined {
  const showBeside = showBesideOf(navigation);
  if (showBeside === null) return undefined;
  return () => {
    if (!showBeside(RESOURCES)) openMachine();
  };
}
