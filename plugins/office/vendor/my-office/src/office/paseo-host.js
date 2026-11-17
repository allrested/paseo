// PASEO: what the page's host, Paseo's office plugin, gives the scene and hears from it.
// paseo-entry.js fills it in before any module is set up; the stand-ins read it.
export const host = {
  /** 'pro' (the company floor) or 'cozy' (one open room). */
  plan: 'pro',
  /** Paseo's dark theme draws the office by night. */
  night: false,
  /** The app's surface colour: the plain backdrop behind the floor. */
  surface: '#F4EFE6',
  /** The host's name, painted into a photo's mark; empty while Paseo has no brand. */
  brandName: '',
  /** A person was chosen; null when nobody is. */
  select() {},
  /** A team's chip was chosen (its project), or the whiteboard (nothing). */
  board() {},
  /** The server racks, or the wall screen while `resources` is null, were chosen; null while Paseo has nothing to open for them. */
  machine: null,
  /** The server room's wall screen was chosen; null while Paseo has nothing to show for it (the screen opens `machine` then). */
  resources: null,
  /** The library's chip or the bookshelf was chosen; null while Paseo has nothing to open for them. */
  library: null,
  /** The bell on the meeting table was clicked; null while Paseo does nothing for it. */
  bell: null,
  /** The label over the meeting room's screen was chosen; null while Paseo has nothing to open for it. */
  notes: null,
  /** A short line the office says once. */
  toast() {},
  /** Usage windows, as upstream's plan card has them: [{ key, pct, resetsAt }]. */
  limits: () => [],
  /** The whiteboard's rows: [{ id, name, color, text, state: 'doing' | 'wait' | 'done' }]. */
  boardRows: () => [],
};
