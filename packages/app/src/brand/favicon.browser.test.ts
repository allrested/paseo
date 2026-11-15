import { describe, expect, it } from "vitest";
import { brandFaviconHref } from "./favicon";

/** A square icon in one colour, as a data address. */
function plainIcon(color: string): string {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d")!;
  context.fillStyle = color;
  context.fillRect(0, 0, 128, 128);
  return canvas.toDataURL("image/png");
}

/** The colour of one point of a drawn icon, as [red, green, blue, alpha]. */
async function pixel(href: string, x: number, y: number): Promise<number[]> {
  const image = new Image();
  image.src = href;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d")!;
  context.drawImage(image, 0, 0);
  return Array.from(context.getImageData(x, y, 1, 1).data);
}

describe("the tab's icon under a brand icon", () => {
  it("is the brand icon as it is while nothing runs", async () => {
    const icon = plainIcon("#aa0000");
    expect(await brandFaviconHref(icon, "none")).toBe(icon);
  });

  it("draws the running dot at the bottom right, with a clear ring around it", async () => {
    const href = await brandFaviconHref(plainIcon("#aa0000"), "running");

    expect(href.startsWith("data:image/png")).toBe(true);
    // 64 px: the icon, the dot's centre, and the ring between the two.
    expect(await pixel(href, 4, 4)).toEqual([170, 0, 0, 255]);
    expect(await pixel(href, 51, 51)).toEqual([59, 130, 246, 255]);
    expect((await pixel(href, 51, 37))[3]).toBe(0);
  });

  it("draws the attention dot in its own colour", async () => {
    const href = await brandFaviconHref(plainIcon("#aa0000"), "attention");

    expect(await pixel(href, 51, 51)).toEqual([34, 197, 94, 255]);
  });

  it("keeps the plain icon when the icon does not load", async () => {
    expect(await brandFaviconHref("/_brand/missing.png", "running")).toBe("/_brand/missing.png");
  });
});
