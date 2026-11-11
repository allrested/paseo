import type { SkillId } from "../shared/catalog.js";
import type { SkillSwitches } from "../shared/settings.js";

/** How many of the bundle's skills are on. */
export function countOn(values: SkillSwitches, members: readonly SkillId[]): number {
  return members.filter((id) => values[id]).length;
}

/** The switches after the bundle's switch moved: every member follows it, the rest stay. */
export function switchBundle(
  values: SkillSwitches,
  members: readonly SkillId[],
  next: boolean,
): SkillSwitches {
  const result = { ...values };
  for (const id of members) result[id] = next;
  return result;
}

/** The hint of the bundle's switch. The switch itself is on only when every member is. */
export function describeBundle(on: number, total: number): string {
  return on === 0 ? "Off" : `${on} of ${total} on`;
}
