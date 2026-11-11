// Web only. Every function is called only when layout.platform is "web" (office-surface.tsx),
// and none touches the DOM at module top level, because esbuild bundles this file for every
// platform.

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

function matches(query: string): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(query).matches
    : false;
}

export function prefersReducedMotion(): boolean {
  return matches("(prefers-reduced-motion: reduce)");
}

export function isCoarsePointer(): boolean {
  return matches("(pointer: coarse)");
}

/**
 * Evaluates an ES module from bytes and returns its namespace. The import lives in a string so
 * esbuild's CJS output does not rewrite it into a require() the app's evaluator would refuse,
 * and only a browser ever parses it. The three.js build is an ES module, which eval cannot run.
 */
export async function evaluateModule(bytes: Uint8Array<ArrayBuffer>): Promise<unknown> {
  const url = URL.createObjectURL(new Blob([bytes], { type: "text/javascript" }));
  try {
    const importModule = new Function("url", "return import(url);");
    const namespace: unknown = await Reflect.apply(importModule, undefined, [url]);
    return namespace;
  } finally {
    URL.revokeObjectURL(url);
  }
}
