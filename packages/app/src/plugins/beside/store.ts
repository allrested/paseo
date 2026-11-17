import { create } from "zustand";
import type { ResolvedBesideTarget } from "@/plugins/host-navigation-model";

interface BesideArea {
  target: ResolvedBesideTarget;
  revision: number;
}

interface BesideState {
  areas: Record<string, BesideArea>;
  width: number | null;
  /** Keyed by the frame that shows the area (beside-area.tsx), not by its surface. */
  show: (areaKey: string, target: ResolvedBesideTarget) => void;
  close: (areaKey: string) => void;
  setWidth: (width: number) => void;
}

export function besideTabId(surfaceKey: string): string {
  return `beside:${surfaceKey}`;
}

export function sameBesideTarget(a: ResolvedBesideTarget, b: ResolvedBesideTarget): boolean {
  if (a.kind === "agent") {
    return b.kind === "agent" && a.serverId === b.serverId && a.agentId === b.agentId;
  }
  return (
    b.kind === "screen" &&
    a.serverId === b.serverId &&
    a.pluginId === b.pluginId &&
    a.screenId === b.screenId &&
    JSON.stringify(a.params) === JSON.stringify(b.params)
  );
}

// One counter for every area, never reset: a body keyed on the revision remounts even when a close
// and a new target land in the same render.
let lastRevision = 0;

export const useBesideStore = create<BesideState>((set) => ({
  areas: {},
  width: null,
  show: (areaKey, target) =>
    set((state) => {
      const shown: BesideArea | undefined = state.areas[areaKey];
      if (shown && sameBesideTarget(shown.target, target)) return state;
      lastRevision += 1;
      return { areas: { ...state.areas, [areaKey]: { target, revision: lastRevision } } };
    }),
  close: (areaKey) =>
    set((state) => {
      if (!state.areas[areaKey]) return state;
      const { [areaKey]: _closed, ...areas } = state.areas;
      return { areas };
    }),
  setWidth: (width) => set({ width }),
}));
