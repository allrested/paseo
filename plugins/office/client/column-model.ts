export type ColumnTab = "attention" | "sessions" | "activity" | "chat";

/** The column's tabs, in their order. The icons are Lucide names. */
export const COLUMN_TABS: readonly { tab: ColumnTab; label: string; icon: string }[] = [
  { tab: "attention", label: "Attention", icon: "Bell" },
  { tab: "sessions", label: "Sessions", icon: "Users" },
  { tab: "activity", label: "Activity", icon: "Activity" },
  { tab: "chat", label: "Chat", icon: "MessageCircle" },
];

export const COLUMN_MIN = 280;
export const COLUMN_MAX = 560;
export const COLUMN_DEFAULT = 360;
/** What the floor keeps beside the column, while the surface is wide enough for both. */
export const FLOOR_MIN = 320;

/**
 * The column's width on a surface of `surface` px. Zero is a surface not measured yet: only the
 * column's own limits apply then.
 */
export function clampColumn(width: number, surface: number): number {
  const room = surface > 0 ? surface - FLOOR_MIN : COLUMN_MAX;
  const most = Math.max(COLUMN_MIN, Math.min(COLUMN_MAX, room));
  return Math.round(Math.min(most, Math.max(COLUMN_MIN, width)));
}

/** A tab's badge: nothing at zero, and no more than two digits. */
export function countLabel(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? "99+" : String(count);
}
