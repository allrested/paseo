import { create } from "zustand";
import type { ResolvedBesideTarget } from "@/plugins/host-navigation-model";

interface BesideArea {
  target: ResolvedBesideTarget;
  revision: number;
}

interface BesideState {
  areas: Record<string, BesideArea>;
  width: number | null;
  show: (surfaceKey: string, target: ResolvedBesideTarget) => void;
  close: (surfaceKey: string) => void;
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
  show: (surfaceKey, target) =>
    set((state) => {
      const shown: BesideArea | undefined = state.areas[surfaceKey];
      if (shown && sameBesideTarget(shown.target, target)) return state;
      lastRevision += 1;
      return { areas: { ...state.areas, [surfaceKey]: { target, revision: lastRevision } } };
    }),
  close: (surfaceKey) =>
    set((state) => {
      if (!state.areas[surfaceKey]) return state;
      const { [surfaceKey]: _closed, ...areas } = state.areas;
      return { areas };
    }),
  setWidth: (width) => set({ width }),
}));
