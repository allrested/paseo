import { useEffect } from "react";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";

type Navigation = PluginSurfaceProps["navigation"];

/** The screens the office's header buttons open beside the floor. */
export const SESSIONS_SCREEN = "office-sessions";
export const ACTIVITY_SCREEN = "office-activity";

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
 * One surface is mounted at a time.
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
 * A panel's row press: the office beside it selects the agent, and where no office is mounted —
 * the screen on its own route — the agent's workspace opens instead.
 */
export function linkSelect(agentId: string, navigation: Navigation): void {
  if (registered !== null) {
    registered.select(agentId);
    return;
  }
  navigation?.openAgent({ agentId });
}

/** A panel's "Open session", as `linkSelect` is its row press. */
export function linkOpenSession(agentId: string, navigation: Navigation): void {
  if (registered !== null) {
    registered.openSession(agentId);
    return;
  }
  navigation?.openAgent({ agentId });
}
