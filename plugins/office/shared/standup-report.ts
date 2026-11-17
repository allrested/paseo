import type { OfficeSnapshot } from "./contracts.js";
import { buildOfficeModel } from "./model.js";
import { standupTeams, standupText } from "./standup-text.js";

/** The stand-up as plain text, built from the hub's snapshot: what the card's Copy as text gives. */
export function standupReport(snapshot: OfficeSnapshot, now: number): string {
  return standupText(standupTeams(buildOfficeModel(snapshot), now));
}
