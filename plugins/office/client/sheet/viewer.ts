// When the sheet view asks the host for a page, and what it tells it about its size. Pure.

/** The host closes a sheet that hears nothing for 30 seconds. */
export const KEEP_ALIVE_MS = 10_000;

interface Size {
  width: number;
  height: number;
}

/**
 * The view's size, or null while it has none. A hidden workspace tab measures 0 x 0: its sheet
 * closes, so a view nobody sees holds none of the host's two places.
 */
export function sizeAfterLayout(previous: Size | null, width: number, height: number): Size | null {
  if (width < 1 || height < 1) return null;
  if (previous !== null && previous.width === width && previous.height === height) return previous;
  return { width, height };
}

/** The sheet runs only for a view that has a size, in an app that is not in the background. */
export function viewShown(size: Size | null, appState: string): size is Size {
  return size !== null && appState !== "background";
}

/** The size to tell the host, or null when it already has it. */
export function resizeToSend(sent: Size, now: Size): Size | null {
  return sent.width === now.width && sent.height === now.height ? null : now;
}
