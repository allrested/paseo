// PASEO: what the page's host, Paseo's office plugin, gives the scene and hears from it.
// paseo-entry.js fills it in before any module is set up; the stand-ins read it.
export const host = {
  /** 'pro' (the company floor) or 'cozy' (one open room). */
  plan: 'pro',
  /** Paseo's dark theme draws the office by night. */
  night: false,
  /** The app's surface colour: the plain backdrop behind the floor. */
  surface: '#F4EFE6',
  /** A person was chosen; null when nobody is. */
  select() {},
  /** A team's chip was chosen (its project), or the whiteboard (nothing). */
  board() {},
  /** The server racks or the wall screen were chosen; null while Paseo has nothing to open for them. */
  machine: null,
  /** The library's chip or the bookshelf was chosen; null while Paseo has nothing to open for them. */
  library: null,
  /** A short line the office says once. */
  toast() {},
  /** Usage windows, as upstream's plan card has them: [{ key, pct, resetsAt }]. */
  limits: () => [],
  /** The whiteboard's rows: [{ id, name, color, text, state: 'doing' | 'wait' | 'done' }]. */
  boardRows: () => [],
};
