/**
 * The side area the app draws beside a plugin's screen or workspace panel, for what the plugin
 * asks to show through `navigation.showBeside`. Each kind of target registers itself when its
 * module loads; this file imports them.
 */

// oxlint-disable-next-line import/no-unassigned-import -- The screen kind registers itself on import.
import "./screen-beside";
// oxlint-disable-next-line import/no-unassigned-import -- The agent kind registers itself on import.
import "./agent-beside";

export { BesideFrame, useShowBeside } from "./beside-area";
