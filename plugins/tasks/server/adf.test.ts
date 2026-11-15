import { expect, test } from "vitest";
import { adfToText, textToAdf } from "./adf.js";

const text = (value: string) => ({ type: "text", text: value });
const paragraph = (...content: unknown[]) => ({ type: "paragraph", content });
const doc = (...content: unknown[]) => ({ type: "doc", version: 1, content });

test("joins paragraphs with a blank line and keeps hard breaks", () => {
  expect(
    adfToText(
      doc(paragraph(text("One"), { type: "hardBreak" }, text("two")), paragraph(text("Three"))),
    ),
  ).toBe("One\ntwo\n\nThree");
});

test("writes headings, lists with nested items, code and quotes", () => {
  const item = (...content: unknown[]) => ({ type: "listItem", content });
  const value = doc(
    { type: "heading", attrs: { level: 2 }, content: [text("Steps")] },
    {
      type: "orderedList",
      content: [
        item(paragraph(text("Open the page"))),
        item(paragraph(text("Check")), {
          type: "bulletList",
          content: [item(paragraph(text("the header"))), item(paragraph(text("the footer")))],
        }),
      ],
    },
    { type: "codeBlock", attrs: { language: "sh" }, content: [text("npm test")] },
    { type: "blockquote", content: [paragraph(text("Quoted")), paragraph(text("twice"))] },
    { type: "rule" },
  );
  expect(adfToText(value)).toBe(
    [
      "## Steps",
      "",
      "1. Open the page",
      "2. Check",
      "   - the header",
      "   - the footer",
      "",
      "```",
      "npm test",
      "```",
      "",
      "> Quoted",
      "> twice",
      "",
      "---",
    ].join("\n"),
  );
});

test("keeps what mentions, emoji, statuses and link cards say, and drops pictures", () => {
  const value = doc(
    paragraph(
      { type: "mention", attrs: { id: "1", text: "@Rina" } },
      text(" see "),
      { type: "inlineCard", attrs: { url: "https://example.com/spec" } },
      text(" "),
      { type: "emoji", attrs: { shortName: ":tada:" } },
      text(" "),
      { type: "status", attrs: { text: "BLOCKED" } },
    ),
    { type: "mediaSingle", content: [{ type: "media", attrs: { id: "abc" } }] },
  );
  expect(adfToText(value)).toBe("@Rina see https://example.com/spec :tada: BLOCKED");
});

test("writes a table as one line per row", () => {
  const cell = (type: string, value: string) => ({ type, content: [paragraph(text(value))] });
  const row = (...content: unknown[]) => ({ type: "tableRow", content });
  const value = doc({
    type: "table",
    content: [
      row(cell("tableHeader", "Field"), cell("tableHeader", "Rule")),
      row(cell("tableCell", "amount"), cell("tableCell", "above zero")),
    ],
  });
  expect(adfToText(value)).toBe("Field | Rule\namount | above zero");
});

test("reads through node types it does not know", () => {
  const value = doc({ type: "panel", content: [paragraph(text("Inside a panel"))] });
  expect(adfToText(value)).toBe("Inside a panel");
});

test("returns a plain string trimmed, and nothing for a missing or odd value", () => {
  expect(adfToText("  wiki text \n")).toBe("wiki text");
  expect(adfToText(null)).toBe("");
  expect(adfToText(undefined)).toBe("");
  expect(adfToText(7)).toBe("");
});

test("plain text becomes paragraphs, with line breaks kept and nothing read as markup", () => {
  expect(textToAdf("Looks *good*.\r\nOne nit below.\n\n\n  [link](x)  \n")).toEqual({
    type: "doc",
    version: 1,
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Looks *good*." },
          { type: "hardBreak" },
          { type: "text", text: "One nit below." },
        ],
      },
      { type: "paragraph", content: [{ type: "text", text: "[link](x)" }] },
    ],
  });
});

test("text written as a document reads back as the same text", () => {
  const written = "First line\nsecond line\n\nNext paragraph";
  expect(adfToText(textToAdf(written))).toBe(written);
});
