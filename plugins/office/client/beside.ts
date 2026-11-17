import type { PluginBesideTarget, PluginSurfaceProps } from "@getpaseo/plugin/client";

type Navigation = PluginSurfaceProps["navigation"];

const RESOURCES: PluginBesideTarget = {
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
  if (navigation.showBeside?.({ kind: "agent", agentId }) === true) return true;
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
  const showBeside = navigation?.showBeside;
  if (showBeside === undefined) return undefined;
  return () => {
    if (!showBeside(RESOURCES)) openMachine();
  };
}
