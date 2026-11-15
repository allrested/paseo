// Jira Cloud keeps rich text as an Atlassian Document Format tree. An agent reads text, so this
// keeps the words and the structure a reader needs (headings, lists, code, quotes, table rows)
// and drops the styling.
/**
 * Plain text as a document, for a comment: a blank line starts a paragraph and a line break
 * stays one. Nothing in the text is read as markup.
 */
export function textToAdf(text: string): unknown {
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "");
  return {
    type: "doc",
    version: 1,
    content: paragraphs.map((paragraph) => {
      const content: unknown[] = [];
      for (const [index, line] of paragraph.split("\n").entries()) {
        if (index > 0) content.push({ type: "hardBreak" });
        // An empty text node is no valid document.
        if (line !== "") content.push({ type: "text", text: line });
      }
      return { type: "paragraph", content };
    }),
  };
}

interface AdfNode {
  type?: unknown;
  text?: unknown;
  attrs?: unknown;
  content?: unknown;
}

function isNode(value: unknown): value is AdfNode {
  return typeof value === "object" && value !== null;
}

function children(node: AdfNode): AdfNode[] {
  return Array.isArray(node.content) ? node.content.filter(isNode) : [];
}

function attr(node: AdfNode, name: string): string {
  if (!isNode(node.attrs)) return "";
  const value = (node.attrs as Record<string, unknown>)[name];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function inline(node: AdfNode): string {
  switch (node.type) {
    case "text":
      return typeof node.text === "string" ? node.text : "";
    case "hardBreak":
      return "\n";
    case "mention":
    case "emoji":
    case "status":
      return attr(node, "text") || attr(node, "shortName");
    case "inlineCard":
      return attr(node, "url");
    default:
      return children(node).map(inline).join("");
  }
}

function blocks(node: AdfNode, separator: string): string {
  return children(node).map(block).filter(Boolean).join(separator);
}

function prefixed(text: string, first: string, rest: string): string {
  return text
    .split("\n")
    .map((line, index) => `${index === 0 ? first : rest}${line}`)
    .join("\n");
}

function list(node: AdfNode, ordered: boolean): string {
  return children(node)
    .map((item, index) => {
      const marker = ordered ? `${index + 1}. ` : "- ";
      return prefixed(blocks(item, "\n"), marker, " ".repeat(marker.length));
    })
    .join("\n");
}

function block(node: AdfNode): string {
  switch (node.type) {
    case "paragraph":
      return inline(node);
    case "heading":
      return `${"#".repeat(Number(attr(node, "level")) || 1)} ${inline(node)}`;
    case "bulletList":
      return list(node, false);
    case "orderedList":
      return list(node, true);
    case "codeBlock":
      return `\`\`\`\n${inline(node)}\n\`\`\``;
    case "blockquote":
      return prefixed(blocks(node, "\n"), "> ", "> ");
    case "rule":
      return "---";
    case "tableRow":
      return children(node)
        .map((cell) => blocks(cell, " "))
        .join(" | ");
    case "table":
      return blocks(node, "\n");
    case "mediaSingle":
    case "mediaGroup":
    case "media":
      return "";
    default:
      return children(node).length > 0 ? blocks(node, "\n\n") : inline(node);
  }
}

/** A Jira rich-text value as plain text. A string is returned as it is; anything else is empty. */
export function adfToText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!isNode(value)) return "";
  return blocks(value, "\n\n").trim();
}
