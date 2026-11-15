import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { BRAND_FILE_MAX_BYTES, loadBrand } from "./brand.js";

/** The first bytes of a PNG of the given size: its signature and its IHDR chunk. */
function pngOf(width: number, height: number): Buffer {
  const header = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write("IHDR", 12, "ascii");
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return header;
}

interface Warning {
  variable?: string;
  reason?: string;
  msg?: string;
}

describe("the web UI's brand", () => {
  let folder: string;
  let warnings: Warning[];
  let logger: pino.Logger;

  beforeEach(async () => {
    folder = await mkdtemp(path.join(os.tmpdir(), "paseo-brand-"));
    warnings = [];
    logger = pino(
      { level: "warn" },
      { write: (line: string) => void warnings.push(JSON.parse(line) as Warning) },
    );
  });

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  const file = async (name: string, body: string | Buffer) => {
    const full = path.join(folder, name);
    await writeFile(full, body);
    return full;
  };

  test("no setting is no brand", async () => {
    expect(await loadBrand(undefined, logger)).toBeNull();
    expect(await loadBrand({}, logger)).toBeNull();
    expect(await loadBrand({ name: "  ", color: "" }, logger)).toBeNull();
    expect(warnings).toEqual([]);
  });

  test("each setting is read, and the files are held with their type and size", async () => {
    const logo = await file("logo.SVG", "<svg xmlns='http://www.w3.org/2000/svg'/>");
    const icon = await file("icon.png", pngOf(512, 512));

    const brand = await loadBrand({ name: "  Acme Agents ", color: "#1a2B3c", logo, icon }, logger);

    expect(brand?.name).toBe("Acme Agents");
    expect(brand?.color).toBe("#1a2B3c");
    expect(brand?.logo).toMatchObject({ contentType: "image/svg+xml" });
    expect(brand?.logo?.body.toString()).toBe("<svg xmlns='http://www.w3.org/2000/svg'/>");
    expect(brand?.icon).toMatchObject({ contentType: "image/png", width: 512, height: 512 });
    // The tag and the version are the same hash, so a changed file changes both.
    expect(brand?.logo?.etag).toBe(`"${brand?.logo?.version}"`);
    expect(brand?.logo?.version).toMatch(/^[0-9a-f]{16}$/);
    expect(warnings).toEqual([]);
  });

  test("one setting alone is a brand", async () => {
    expect(await loadBrand({ name: "Acme" }, logger)).toEqual({
      name: "Acme",
      color: null,
      logo: null,
      icon: null,
    });
  });

  test("a setting that cannot be used is logged and left out, and the others apply", async () => {
    const text = await file("logo.txt", "not an image");
    const fake = await file("icon.png", "not a png, though it is named like one");
    const big = await file("big.png", Buffer.alloc(BRAND_FILE_MAX_BYTES + 1));

    const brand = await loadBrand({ name: "Acme", color: "teal", logo: text, icon: fake }, logger);
    const missing = await loadBrand({ logo: path.join(folder, "none.svg"), icon: big }, logger);
    const long = await loadBrand({ name: "x".repeat(41) }, logger);
    const control = await loadBrand({ name: "Acme\u0007" }, logger);
    const pattern = await loadBrand({ name: "Acme {{count}}" }, logger);

    expect(brand).toEqual({ name: "Acme", color: null, logo: null, icon: null });
    expect(missing).toBeNull();
    expect(long).toBeNull();
    expect(control).toBeNull();
    expect(pattern).toBeNull();
    expect(warnings.map((each) => [each.variable, each.reason])).toEqual([
      ["PASEO_BRAND_COLOR", "not a #RRGGBB colour"],
      ["PASEO_BRAND_LOGO", "not one of .svg, .png, .jpg, .jpeg, .webp"],
      ["PASEO_BRAND_ICON", "not a PNG image"],
      ["PASEO_BRAND_LOGO", "cannot be read"],
      ["PASEO_BRAND_ICON", `larger than ${BRAND_FILE_MAX_BYTES} bytes`],
      ["PASEO_BRAND_NAME", "longer than 40 characters"],
      ["PASEO_BRAND_NAME", "has a control character"],
      ["PASEO_BRAND_NAME", "has {{ or $t(, which the app's text reads as a pattern"],
    ]);
  });

  test("an icon that is small or not square is used, with a warning", async () => {
    const small = await loadBrand({ icon: await file("small.png", pngOf(64, 64)) }, logger);
    const wide = await loadBrand({ icon: await file("wide.png", pngOf(512, 256)) }, logger);

    expect(small?.icon).toMatchObject({ width: 64, height: 64 });
    expect(wide?.icon).toMatchObject({ width: 512, height: 256 });
    expect(warnings.map((each) => [each.msg, each.reason])).toEqual([
      ["Brand icon may not install", "64 px is under 192 px"],
      ["Brand icon may not install", "512x256 is not square"],
    ]);
  });
});
