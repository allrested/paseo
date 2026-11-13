export const MAX_ELEMENTS = 200;

export interface ScreenElement {
  ref: string;
  text: string;
  description: string;
  id: string;
  bounds: { left: number; top: number; right: number; bottom: number };
  clickable: boolean;
  focused: boolean;
  scrollable: boolean;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1] === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return ENTITIES[body] ?? whole;
  });
}

const ATTRIBUTE = /\s+([A-Za-z_][\w:.-]*)="([^"]*)"/y;
const BOUNDS = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/;

/** Reads the attributes of the node whose tag starts at `from`; null when the tag is cut off. */
function readAttributes(xml: string, from: number): Record<string, string> | null {
  const attributes: Record<string, string> = {};
  let position = from;
  for (;;) {
    ATTRIBUTE.lastIndex = position;
    const match = ATTRIBUTE.exec(xml);
    if (match === null) break;
    attributes[match[1]!] = decode(match[2]!);
    position = ATTRIBUTE.lastIndex;
  }
  const rest = xml.slice(position, position + 8).trimStart();
  return rest.startsWith("/>") || rest.startsWith(">") ? attributes : null;
}

/** The elements of a uiautomator dump. Pure; never throws; at most MAX_ELEMENTS. */
export function parseSnapshot(xml: string): ScreenElement[] {
  const elements: ScreenElement[] = [];
  try {
    const start = /<node(?=[\s/>])/g;
    while (elements.length < MAX_ELEMENTS && start.exec(xml) !== null) {
      const attributes = readAttributes(xml, start.lastIndex);
      if (attributes === null) continue;
      const bounds = BOUNDS.exec(attributes.bounds ?? "");
      if (bounds === null) continue;
      const [left, top, right, bottom] = bounds.slice(1).map(Number) as [
        number,
        number,
        number,
        number,
      ];
      if (right <= left || bottom <= top) continue;
      const text = attributes.text ?? "";
      const description = attributes["content-desc"] ?? "";
      const id = attributes["resource-id"] ?? "";
      const clickable = attributes.clickable === "true";
      const scrollable = attributes.scrollable === "true";
      if (!text && !description && !id && !clickable && !scrollable) continue;
      elements.push({
        ref: `@a${elements.length + 1}`,
        text,
        description,
        id,
        bounds: { left, top, right, bottom },
        clickable,
        focused: attributes.focused === "true",
        scrollable,
      });
    }
  } catch {
    // A parser that fails keeps what it has read.
  }
  return elements;
}

export function centerOf(element: ScreenElement): { x: number; y: number } {
  const { left, top, right, bottom } = element.bounds;
  return { x: Math.round((left + right) / 2), y: Math.round((top + bottom) / 2) };
}

export function snapshotText(input: {
  packageName: string | null;
  activity: string | null;
  elements: ScreenElement[];
}): string {
  const app = input.packageName
    ? `${input.packageName}${input.activity ? `/${input.activity}` : ""}`
    : "unknown";
  const lines = [`App: ${app}`];
  if (input.elements.length === 0) lines.push("(no elements on the screen)");
  for (const element of input.elements) {
    const label = element.text || element.description;
    const parts = [element.ref];
    if (label) parts.push(JSON.stringify(label));
    if (element.clickable) parts.push("[button]");
    if (element.scrollable) parts.push("[scroll]");
    if (element.id) parts.push(`id=${element.id}`);
    lines.push(parts.join(" "));
  }
  return lines.join("\n");
}
