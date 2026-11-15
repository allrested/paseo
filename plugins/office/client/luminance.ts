interface Rgb {
  r: number;
  g: number;
  b: number;
}

const MID_GREY: Rgb = { r: 128, g: 128, b: 128 };

/** A theme colour as channels: #rgb, #rrggbb, #rrggbbaa, rgb() or rgba(); null for anything else. */
export function parseColor(value: string): Rgb | null {
  const text = value.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(text);
  if (short) {
    const [, r = "0", g = "0", b = "0"] = short;
    return { r: parseInt(r + r, 16), g: parseInt(g + g, 16), b: parseInt(b + b, 16) };
  }
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/.exec(text);
  if (long) {
    const [, r = "00", g = "00", b = "00"] = long;
    return { r: parseInt(r, 16), g: parseInt(g, 16), b: parseInt(b, 16) };
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(text);
  if (rgb) {
    const [, r = "0", g = "0", b = "0"] = rgb;
    return { r: Number(r), g: Number(g), b: Number(b) };
  }
  return null;
}

/** WCAG relative luminance, 0 for black to 1 for white. An unreadable colour counts as mid grey. */
export function relativeLuminance(color: string): number {
  const { r, g, b } = parseColor(color) ?? MID_GREY;
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}
