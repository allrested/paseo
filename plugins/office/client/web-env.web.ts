// Web only. Every function asks for a document before it uses one, and none touches the DOM at
// module top level, because esbuild bundles this file for every platform.

export function hasWebGL2(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2");
    if (context === null) return false;
    context.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/**
 * Calls `onSpace` when Space goes down on the element with this id, and returns what stops it.
 * react-native-web presses on Space only for a button; a switch is turned with Space (WAI-ARIA).
 * Without a document (native) nothing is listened to.
 */
export function listenForSpace(elementId: string, onSpace: () => void): () => void {
  const element = typeof document === "undefined" ? null : document.getElementById(elementId);
  if (element === null) return () => undefined;
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== " " && event.key !== "Spacebar") return;
    // Space scrolls the page; a key held down turns the switch once.
    event.preventDefault();
    if (!event.repeat) onSpace();
  };
  element.addEventListener("keydown", onKeyDown);
  return () => element.removeEventListener("keydown", onKeyDown);
}
