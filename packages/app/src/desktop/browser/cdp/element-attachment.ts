// The composer attachment for an element picked in the daemon's browser. The text an agent reads
// is written as the desktop pane writes it (formatElementAttachment in ../pane/index.electron.tsx,
// a file only an Electron build loads), so an element reads the same whichever browser it was
// picked in. Change both when the format changes.
import type { CdpBrowserElementSelection } from "@getpaseo/protocol/browser-automation/cdp-view-schemas";
import type { BrowserElementAttachment } from "@/attachments/types";

const KEY_STYLES = new Set(["display", "position", "font-size", "color", "background-color"]);

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength).trim()}...` : value;
}

function sourceLine(selection: CdpBrowserElementSelection): string | null {
  const source = selection.reactSource;
  if (!source?.fileName) return null;
  const line = source.lineNumber != null ? `:${source.lineNumber}` : "";
  const column = source.columnNumber != null ? `:${source.columnNumber}` : "";
  return `source: ${source.componentName ?? selection.tag} @ ${source.fileName}${line}${column}`;
}

export function formatElementAttachment(
  selection: CdpBrowserElementSelection,
  comment: string,
): string {
  const textPreview = truncateText(selection.text.trim(), 200);
  const keyStyles = Object.entries(selection.computedStyles)
    .filter(([key]) => KEY_STYLES.has(key))
    .map(([key, value]) => `${key}: ${value}`)
    .join("; ");
  const parts = [
    sourceLine(selection),
    `selector: ${selection.selector}`,
    textPreview ? `text: ${JSON.stringify(textPreview)}` : null,
    `size: ${selection.boundingRect.width}x${selection.boundingRect.height}`,
    keyStyles ? `styles: ${keyStyles}` : null,
    selection.parentChain.length > 0
      ? `parents: ${selection.parentChain.slice(0, 3).join(" > ")}`
      : null,
    comment.trim() ? `feedback: ${comment.trim()}` : null,
  ].filter((part): part is string => part !== null);
  return [
    `<browser-element url="${selection.url}">`,
    parts.map((part) => `  ${part}`).join("\n"),
    `  html: ${truncateText(selection.outerHTML.trim(), 800)}`,
    `</browser-element>`,
  ].join("\n");
}

export function buildElementAttachment(
  selection: CdpBrowserElementSelection,
  comment: string,
): BrowserElementAttachment {
  const note = comment.trim();
  return {
    ...selection,
    outerHTML: truncateText(selection.outerHTML, 2000),
    ...(note ? { comment: note } : {}),
    formatted: formatElementAttachment(selection, comment),
  };
}

/** One line that names the picked element to the person writing a note about it. */
export function elementLabel(selection: CdpBrowserElementSelection): string {
  const text = truncateText(selection.text.trim().replace(/\s+/g, " "), 60);
  return text ? `${selection.tag} · ${text}` : selection.tag;
}
