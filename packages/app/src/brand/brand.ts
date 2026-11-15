// The host's own name and logo in place of Paseo's, on the web UI a daemon serves. The daemon
// writes them into the page (packages/server/src/server/web-ui.ts, injectBrand); native and
// desktop builds have none. No React Native import: the translations load this before the app.

export interface Brand {
  /** Shown wherever the app's text says "Paseo"; null keeps the name. */
  name: string | null;
  /** The logo's address on the serving daemon; null keeps Paseo's mark. */
  logoUrl: string | null;
  /** The icon's address on the serving daemon; null keeps Paseo's favicons. */
  iconUrl: string | null;
}

/** The software's own name: what the brand replaces, and what the credit line still says. */
export const PRODUCT_NAME = "Paseo";

const GLOBAL_KEY = "__PASEO_BRAND__";
/** The daemon serves the brand's images under this path; any other address is not its own. */
const IMAGE_PATH_PREFIX = "/_brand/";
const imageUrl = (value: unknown) =>
  typeof value === "string" && value.startsWith(IMAGE_PATH_PREFIX) ? value : null;

/** Reads what the daemon wrote into the page. Anything else is no brand. */
export function parseBrand(value: unknown): Brand | null {
  if (typeof value !== "object" || value === null) return null;
  const { name, logoUrl, iconUrl } = value as Record<string, unknown>;
  const brand: Brand = {
    name: typeof name === "string" && name.trim() !== "" ? name : null,
    logoUrl: imageUrl(logoUrl),
    iconUrl: imageUrl(iconUrl),
  };
  return brand.name === null && brand.logoUrl === null && brand.iconUrl === null ? null : brand;
}

let cached: Brand | null | undefined;

/** The page's brand, read once: it cannot change while the page lives. */
export function getBrand(): Brand | null {
  if (cached === undefined) {
    cached = parseBrand((globalThis as Record<string, unknown>)[GLOBAL_KEY]);
  }
  return cached;
}

/** For tests: read the page again at the next call. */
export function resetBrandForTests(): void {
  cached = undefined;
}

// The word alone, as a name: "paseo run" and "paseo.sh" keep theirs.
const PRODUCT_WORD = /\bPaseo\b/g;

/** `text` with the product's name replaced by the brand's. */
export function brandText(text: string, name: string): string {
  // A function, so a "$" in the name is not read as a replacement pattern.
  return text.replace(PRODUCT_WORD, () => name);
}

/** A language's strings with the product's name replaced in every one. Keys are left alone. */
export function brandResources<Resources>(resources: Resources, name: string): Resources {
  const walk = (value: unknown): unknown => {
    if (typeof value === "string") return brandText(value, name);
    if (Array.isArray(value)) return value.map(walk);
    if (typeof value === "object" && value !== null) {
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, walk(child)]));
    }
    return value;
  };
  return walk(resources) as Resources;
}

/** A string written in the code, outside the translations, as the page's brand has it. */
export function branded(text: string): string {
  const name = getBrand()?.name;
  return name ? brandText(text, name) : text;
}

/** A language's strings as the page's brand has them: untouched without a brand name. */
export function withBrand<Resources>(resources: Resources): Resources {
  const name = getBrand()?.name;
  return name ? brandResources(resources, name) : resources;
}
