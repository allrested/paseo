// PASEO: whether the office counts as focused. Upstream's loop (core/loop.js frameGap) draws 8 frames a second while
// document.hasFocus() is false. The scene runs in a frame, and the office hands the keyboard back to Paseo's page
// after every press, so the glide after a drag ran at 8 frames a second. paseo-entry.js makes the frame's
// document.hasFocus() answer with this: focused while Paseo's page or the frame has focus. No imports, so a test runs
// it without a browser.

/** True while the frame (`own`) or the page it sits in (`parentWin`) has focus. */
export function hostFocused(own, parentWin) {
  if (own()) return true;
  try {
    return parentWin?.document?.hasFocus() === true;
  } catch {
    return false;   // (a page of another origin: only the frame's own focus is known)
  }
}

/** Makes `doc.hasFocus()` answer for the page the frame is in. Once per document. */
export function followHostFocus(doc, parentWin) {
  const own = doc.hasFocus.bind(doc);
  doc.hasFocus = () => hostFocused(own, parentWin);
}
