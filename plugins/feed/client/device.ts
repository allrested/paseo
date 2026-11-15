type Platform = "ios" | "android" | "web";

/**
 * The app's hasTouchScreen (packages/app/src/hooks/pointer-capabilities.ts), which a plugin
 * cannot import: native is always a touch screen, and a browser answers for itself.
 */
export function hasTouchScreen(platform: Platform): boolean {
  if (platform !== "web") return true;
  if (typeof window === "undefined") return false;
  const coarse =
    typeof window.matchMedia === "function" && window.matchMedia("(any-pointer: coarse)").matches;
  return coarse || window.navigator.maxTouchPoints > 0;
}
