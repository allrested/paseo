import { describe, expect, test } from "vitest";
import type { CdpBrowserElementSelection } from "@getpaseo/protocol/browser-automation/cdp-view-schemas";
import {
  buildElementAttachment,
  elementLabel,
  formatElementAttachment,
} from "./element-attachment";

const SELECTION: CdpBrowserElementSelection = {
  url: "https://shop.test/cart",
  selector: "#buy",
  tag: "button",
  text: "  Buy now  ",
  outerHTML: '<button id="buy">Buy now</button>',
  computedStyles: {
    display: "block",
    width: "120px",
    color: "rgb(0, 0, 0)",
    "font-size": "13px",
    opacity: "1",
  },
  boundingRect: { x: 20, y: 80, width: 120, height: 40 },
  reactSource: {
    fileName: "/src/cart/buy.tsx",
    lineNumber: 12,
    columnNumber: 5,
    componentName: "BuyButton",
  },
  parentChain: ["form#order", "main#app", "body", "html"],
  children: [],
};

describe("formatElementAttachment", () => {
  test("writes the element as the desktop browser pane does", () => {
    expect(formatElementAttachment(SELECTION, " The label is cut off ")).toBe(
      [
        '<browser-element url="https://shop.test/cart">',
        "  source: BuyButton @ /src/cart/buy.tsx:12:5",
        "  selector: #buy",
        '  text: "Buy now"',
        "  size: 120x40",
        "  styles: display: block; color: rgb(0, 0, 0); font-size: 13px",
        "  parents: form#order > main#app > body",
        "  feedback: The label is cut off",
        '  html: <button id="buy">Buy now</button>',
        "</browser-element>",
      ].join("\n"),
    );
  });

  test("leaves out what the element does not have", () => {
    const bare: CdpBrowserElementSelection = {
      ...SELECTION,
      text: "",
      computedStyles: { width: "120px" },
      reactSource: null,
      parentChain: [],
    };

    expect(formatElementAttachment(bare, "  ")).toBe(
      [
        '<browser-element url="https://shop.test/cart">',
        "  selector: #buy",
        "  size: 120x40",
        '  html: <button id="buy">Buy now</button>',
        "</browser-element>",
      ].join("\n"),
    );
  });

  test("names the tag when the source has no component, and cuts long text and HTML", () => {
    const long: CdpBrowserElementSelection = {
      ...SELECTION,
      text: "a".repeat(300),
      outerHTML: `<p>${"b".repeat(900)}</p>`,
      reactSource: {
        fileName: "/src/x.tsx",
        lineNumber: null,
        columnNumber: null,
        componentName: null,
      },
    };
    const formatted = formatElementAttachment(long, "");

    expect(formatted).toContain("  source: button @ /src/x.tsx\n");
    expect(formatted).toContain(`  text: "${"a".repeat(200)}..."`);
    expect(formatted).toContain(`  html: <p>${"b".repeat(797)}...\n`);
  });
});

describe("buildElementAttachment", () => {
  test("carries the selection, the trimmed note and the formatted text", () => {
    const attachment = buildElementAttachment(SELECTION, " The label is cut off ");

    expect(attachment).toEqual({
      ...SELECTION,
      comment: "The label is cut off",
      formatted: formatElementAttachment(SELECTION, " The label is cut off "),
    });
  });

  test("has no comment when the note is empty", () => {
    expect(buildElementAttachment(SELECTION, "  ")).not.toHaveProperty("comment");
  });
});

test("an element is named by its tag and the start of its text", () => {
  expect(elementLabel(SELECTION)).toBe("button · Buy now");
  expect(elementLabel({ ...SELECTION, text: "" })).toBe("button");
  expect(elementLabel({ ...SELECTION, text: `Buy\n   ${"x".repeat(80)}` })).toBe(
    `button · Buy ${"x".repeat(56)}...`,
  );
});
