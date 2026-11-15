import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Logger } from "pino";

/** A name longer than this does not fit a home screen or a tab. */
export const BRAND_NAME_MAX = 40;
/** A logo or an icon is held in memory and sent to every browser. */
export const BRAND_FILE_MAX_BYTES = 1024 * 1024;
/** The smallest icon a browser takes for an installed app. */
const ICON_MIN_SIDE = 192;

/** The four settings as the environment gives them; the paths are absolute. */
export interface BrandInput {
  name?: string;
  logo?: string;
  icon?: string;
  color?: string;
}

export interface BrandImage {
  body: Buffer;
  contentType: string;
  /** Quoted, as an ETag header carries it. */
  etag: string;
  /** Changes with the file: a URL that carries it is fetched again. */
  version: string;
}

export interface BrandIcon extends BrandImage {
  width: number;
  height: number;
}

/** What the web UI shows in place of Paseo's own. Each part is set on its own. */
export interface Brand {
  name: string | null;
  /** `#RRGGBB`. */
  color: string | null;
  logo: BrandImage | null;
  icon: BrandIcon | null;
}

const LOGO_TYPES: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A setting that cannot be used, and why. */
class BrandSettingError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "BrandSettingError";
  }
}

function hasControlCharacter(text: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || (code >= 0x7f && code < 0xa0)) return true;
  }
  return false;
}

function nameOf(raw: string): string {
  const name = raw.trim();
  if (Array.from(name).length > BRAND_NAME_MAX) {
    throw new BrandSettingError(`longer than ${BRAND_NAME_MAX} characters`);
  }
  if (hasControlCharacter(name)) throw new BrandSettingError("has a control character");
  // The app writes the name into its translated strings, where these start a pattern.
  if (name.includes("{{") || name.includes("$t(")) {
    throw new BrandSettingError("has {{ or $t(, which the app's text reads as a pattern");
  }
  return name;
}

function colorOf(raw: string): string {
  const color = raw.trim();
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new BrandSettingError("not a #RRGGBB colour");
  return color;
}

async function imageOf(file: string, types: Record<string, string>): Promise<BrandImage> {
  const contentType = types[path.extname(file).toLowerCase()];
  if (!contentType) {
    throw new BrandSettingError(`not one of ${Object.keys(types).join(", ")}`);
  }
  const found = await stat(file).catch(() => null);
  if (found === null) throw new BrandSettingError("cannot be read");
  if (!found.isFile()) throw new BrandSettingError("not a file");
  if (found.size > BRAND_FILE_MAX_BYTES) {
    throw new BrandSettingError(`larger than ${BRAND_FILE_MAX_BYTES} bytes`);
  }
  if (found.size === 0) throw new BrandSettingError("empty");
  const body = await readFile(file);
  const version = createHash("sha256").update(body).digest("hex").slice(0, 16);
  return { body, contentType, etag: `"${version}"`, version };
}

async function iconOf(file: string, warn: (reason: string) => void): Promise<BrandIcon> {
  const image = await imageOf(file, { ".png": "image/png" });
  // A PNG starts with its signature, then the IHDR chunk: width and height at bytes 16 and 20.
  if (image.body.length < 24 || !image.body.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new BrandSettingError("not a PNG image");
  }
  const width = image.body.readUInt32BE(16);
  const height = image.body.readUInt32BE(20);
  if (width !== height) warn(`${width}x${height} is not square`);
  else if (width < ICON_MIN_SIDE) warn(`${width} px is under ${ICON_MIN_SIDE} px`);
  return { ...image, width, height };
}

/**
 * Checks the brand settings and reads their files. A setting that cannot be used is logged and
 * left out; the others still apply. Answers null when nothing is set.
 */
export async function loadBrand(
  input: BrandInput | undefined,
  logger: Logger,
): Promise<Brand | null> {
  if (!input) return null;
  const log = logger.child({ module: "brand" });
  async function read<Value>(
    variable: string,
    raw: string | undefined,
    parse: (raw: string) => Value | Promise<Value>,
  ): Promise<Value | null> {
    if (raw === undefined || raw.trim() === "") return null;
    try {
      return await parse(raw);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      log.warn({ variable, reason }, "Brand setting ignored");
      return null;
    }
  }
  const brand: Brand = {
    name: await read("PASEO_BRAND_NAME", input.name, nameOf),
    color: await read("PASEO_BRAND_COLOR", input.color, colorOf),
    logo: await read("PASEO_BRAND_LOGO", input.logo, (file) => imageOf(file.trim(), LOGO_TYPES)),
    icon: await read("PASEO_BRAND_ICON", input.icon, (file) =>
      iconOf(file.trim(), (reason) =>
        log.warn({ variable: "PASEO_BRAND_ICON", reason }, "Brand icon may not install"),
      ),
    ),
  };
  if (!brand.name && !brand.color && !brand.logo && !brand.icon) return null;
  log.info(
    { name: brand.name, color: brand.color, logo: brand.logo !== null, icon: brand.icon !== null },
    "Web UI brand set",
  );
  return brand;
}
