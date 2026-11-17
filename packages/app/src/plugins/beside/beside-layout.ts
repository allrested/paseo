import { MIN_WORKSPACE_BODY_WIDTH } from "@/components/explorer-sidebar-layout";

/** The Explorer's default width, which the side area starts at. */
const START_WIDTH = 320;
const MIN_WIDTH = 240;

/**
 * The wide side area's width: the dragged width, or the start width before any drag, never
 * narrower than its minimum and never so wide that the plugin's content, which shares the
 * container's width with it (the frame around both), drops below the workspace body's minimum.
 */
export function clampBesideWidth(width: number | null, containerWidth: number): number {
  const widest = containerWidth - MIN_WORKSPACE_BODY_WIDTH;
  return Math.max(MIN_WIDTH, Math.min(widest, width ?? START_WIDTH));
}
