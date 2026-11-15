// Names the daemon, the sheet page and the views share. The page is a script in the daemon's
// Chromium (render/sheet-page.ts), so this file must stay free of the schema library.

/** Where the daemon puts the three.js module namespace before the page script runs. */
export const THREE_GLOBAL = "__officeThree";
/** A pointer that moved less than this between down and up is a tap. */
export const TAP_SLOP_PX = 8;
