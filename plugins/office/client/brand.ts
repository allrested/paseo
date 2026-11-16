/** The host's brand, as the daemon writes it into the web page it serves. */
export interface OfficeBrand {
  /** Null keeps the product's name. */
  name: string | null;
  /** The logo's address in full; null when the brand has none. */
  logoUrl: string | null;
}

/** The daemon serves the brand's images under this path; any other address is not its own. */
const IMAGE_PATH_PREFIX = "/_brand/";

/**
 * Reads what the daemon wrote into the page (`window.__PASEO_BRAND__`), with the app's own checks
 * (packages/app/src/brand/brand.ts, which a plugin cannot import). Anything else is no brand. The
 * logo's address is made full against the page's: the 3D office's frame has no address of its own.
 */
export function parseBrand(value: unknown, pageUrl: string): OfficeBrand | null {
  if (typeof value !== "object" || value === null) return null;
  const { name, logoUrl } = value as Record<string, unknown>;
  const brand: OfficeBrand = {
    name: typeof name === "string" && name.trim() !== "" ? name : null,
    logoUrl:
      typeof logoUrl === "string" && logoUrl.startsWith(IMAGE_PATH_PREFIX)
        ? new URL(logoUrl, pageUrl).href
        : null,
  };
  return brand.name === null && brand.logoUrl === null ? null : brand;
}
