// PASEO: the picture on the lobby's sign and the reception's plaque, with the host's brand.
// Upstream draws "My Office" and its mark in world/pro/floor.js, which stays as it is:
// paseo-entry.js puts this picture on the same material once the floor is built. No imports, so
// a test runs it without a browser.

/** The sign's canvas, as upstream sizes it. */
export const SIGN = { width: 1024, height: 220 };
/** Upstream's type size on the sign, and the smallest a long name is drawn at. */
const TYPE_MAX = 92;
const TYPE_MIN = 48;
const TYPE_STEP = 4;
/** The mark's square, centred here; upstream's mark is 24 units drawn 6.2 times as large. */
const MARK_X = 150;
const MARK_BOX = 149;
/** Where the name starts, and the room kept at the sign's end. */
const NAME_X = 260;
const NAME_MARGIN = 40;
const font = (size) => `800 ${size}px "Be Vietnam Pro", system-ui, sans-serif`;

/**
 * The largest type a name fits a width at, and the name as it is drawn. `measure(text, size)` is
 * the text's width at a size. A name too long for the smallest type ends in an ellipsis.
 */
export function fitName(measure, name, maxWidth) {
  for (let size = TYPE_MAX; size >= TYPE_MIN; size -= TYPE_STEP) {
    if (measure(name, size) <= maxWidth) return { size, text: name };
  }
  // Cut by code point: a UTF-16 unit at a time can leave half of an emoji, a broken glyph.
  const chars = Array.from(name);
  while (chars.length > 1 && measure(`${chars.join('')}…`, TYPE_MIN) > maxWidth) chars.pop();
  return { size: TYPE_MIN, text: `${chars.join('').trimEnd()}…` };
}

/**
 * Draws the sign on a 2D context: upstream's board, the mark, the name. `sign.logo` is a loaded
 * image and is fitted into the mark's square; without one, or with one that has no size of its
 * own, `sign.mark(g)` draws the scene's mark.
 */
export function drawSign(g, w, h, sign) {
  g.fillStyle = '#1C2620';
  g.fillRect(0, 0, w, h);
  const { logo } = sign;
  if (logo && logo.width > 0 && logo.height > 0) {
    const scale = Math.min(MARK_BOX / logo.width, MARK_BOX / logo.height);
    const lw = logo.width * scale, lh = logo.height * scale;
    g.drawImage(logo, MARK_X - lw / 2, h / 2 - lh / 2, lw, lh);
  } else {
    sign.mark(g);
  }
  const measure = (text, size) => {
    g.font = font(size);
    return g.measureText(text).width;
  };
  const fitted = fitName(measure, sign.name, w - NAME_X - NAME_MARGIN);
  g.fillStyle = '#F6EFE4';
  g.font = font(fitted.size);
  g.textBaseline = 'middle';
  g.fillText(fitted.text, NAME_X, h / 2 + 4);
}
