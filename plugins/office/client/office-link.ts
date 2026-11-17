import { useEffect } from "react";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";

type Navigation = PluginSurfaceProps["navigation"];

/** The screens the office's header buttons open beside the floor. */
export const SESSIONS_SCREEN = "office-sessions";
export const ACTIVITY_SCREEN = "office-activity";
export const CHAT_SCREEN = "office-chat";

/** What a panel asks of the office surface it was opened beside. */
export interface OfficeLink {
  /** Opens the agent's card, as a press on a List row does. */
  select(agentId: string): void;
  /** Shows the agent's session in the side area, which replaces the panel. */
  openSession(agentId: string): void;
}

/**
 * The surface registered here, if one is. The panels are a second React tree beside the floor,
 * and the plugin's client modules are one bundle, so this module is the channel between them.
 * Two surfaces can be mounted at once (a retained deck or panel), so the one that opens a panel
 * claims the link; a mount registers too, for the 3D to List remount.
 */
let registered: OfficeLink | null = null;

/**
 * Registers the mounted surface's link, and clears it on unmount. A 3D to List remount registers
 * the new tree first, so the old tree's unmount must leave the new registration alone.
 */
export function useOfficeLink(link: OfficeLink): void {
  useEffect(() => {
    registered = link;
    return () => {
      if (registered === link) registered = null;
    };
  }, [link]);
}

/**
 * The office whose header button opens a panel takes the link, so the panel beside it reaches
 * that office and not another mounted one. The area closes when its surface leaves view, so the
 * opener is the office beside the panel.
 */
export function claimOfficeLink(link: OfficeLink): void {
  registered = link;
}

/**
 * The surface a panel may reach, if any. A screen shown in the side area gets a navigation with no
 * `showBeside`, and on its own route it gets one. On its own route the office it came from can
 * still be mounted (and registered) under the route, hidden, so the panel must not reach it.
 */
function reachable(navigation: Navigation): OfficeLink | null {
  return navigation?.showBeside === undefined ? registered : null;
}

/**
 * A panel's row press: the office beside it selects the agent, and where there is none beside
 * it — the screen on its own route — the agent's workspace opens instead.
 */
export function linkSelect(agentId: string, navigation: Navigation): void {
  const surface = reachable(navigation);
  if (surface !== null) {
    surface.select(agentId);
    return;
  }
  navigation?.openAgent({ agentId });
}

/** A panel's "Open session", as `linkSelect` is its row press. */
export function linkOpenSession(agentId: string, navigation: Navigation): void {
  const surface = reachable(navigation);
  if (surface !== null) {
    surface.openSession(agentId);
    return;
  }
  navigation?.openAgent({ agentId });
}
