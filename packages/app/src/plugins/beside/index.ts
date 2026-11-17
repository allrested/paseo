/**
 * The side area the app draws beside a plugin's screen or workspace panel, for what the plugin
 * asks to show through `navigation.showBeside`. Each kind of target registers itself when its
 * module loads; this file imports them.
 */

export { BesideFrame, useShowBeside } from "./beside-area";
