import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { MAX_ELEMENTS, centerOf, parseSnapshot, snapshotText } from "./snapshot.js";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

function node(attributes: Record<string, string>): string {
  const all = {
    text: "",
    "resource-id": "",
    "content-desc": "",
    clickable: "false",
    focused: "false",
    scrollable: "false",
    bounds: "[0,0][10,10]",
    ...attributes,
  };
  const rendered = Object.entries(all)
    .map(([key, value]) => `${key}="${value}"`)
    .join(" ");
  return `<node ${rendered} />`;
}
const hierarchy = (...nodes: string[]) => `<hierarchy rotation="0">${nodes.join("")}</hierarchy>`;

test("refs count from @a1 in document order", () => {
  const elements = parseSnapshot(
    hierarchy(node({ text: "One" }), node({ text: "Two" }), node({ text: "Three" })),
  );
  expect(elements.map((e) => [e.ref, e.text])).toEqual([
    ["@a1", "One"],
    ["@a2", "Two"],
    ["@a3", "Three"],
  ]);
});

test("a node with no text, description, id or action is left out", () => {
  const elements = parseSnapshot(
    hierarchy(
      node({}),
      node({ clickable: "true" }),
      node({ scrollable: "true" }),
      node({ "content-desc": "Back" }),
      node({ "resource-id": "a:id/b" }),
    ),
  );
  expect(elements.map((e) => e.ref)).toEqual(["@a1", "@a2", "@a3", "@a4"]);
  expect(elements[0]).toMatchObject({ clickable: true });
  expect(elements[1]).toMatchObject({ scrollable: true });
  expect(elements[2]).toMatchObject({ description: "Back" });
  expect(elements[3]).toMatchObject({ id: "a:id/b" });
});

test("bounds parse [left,top][right,bottom]", () => {
  const [element] = parseSnapshot(hierarchy(node({ text: "x", bounds: "[0,84][720,180]" })));
  expect(element?.bounds).toEqual({ left: 0, top: 84, right: 720, bottom: 180 });
  expect(centerOf(element!)).toEqual({ x: 360, y: 132 });
});

test("XML entities decode and non-ASCII text survives", () => {
  const elements = parseSnapshot(
    hierarchy(
      node({ text: "Network &amp; internet" }),
      node({ text: "&quot;q&quot; &lt;b&gt; &apos;s&apos; &#65;&#x42;" }),
      node({ text: "الشبكة ✓ 日本語" }),
    ),
  );
  expect(elements.map((e) => e.text)).toEqual([
    "Network & internet",
    `"q" <b> 's' AB`,
    "الشبكة ✓ 日本語",
  ]);
});

test("an attribute value may hold a > character", () => {
  const [element] = parseSnapshot(hierarchy(node({ text: "a > b" })));
  expect(element?.text).toBe("a > b");
});

test("a node with malformed, missing or empty bounds is skipped", () => {
  const elements = parseSnapshot(
    hierarchy(
      node({ text: "bad", bounds: "[0,0][x,y]" }),
      node({ text: "none", bounds: "" }),
      '<node text="no bounds attribute" />',
      node({ text: "flat", bounds: "[5,5][5,50]" }),
      node({ text: "good" }),
    ),
  );
  expect(elements.map((e) => e.text)).toEqual(["good"]);
  expect(elements[0]?.ref).toBe("@a1");
});

test("an empty or non-XML string gives an empty list", () => {
  expect(parseSnapshot("")).toEqual([]);
  expect(parseSnapshot("not xml at all")).toEqual([]);
  expect(parseSnapshot("<hierarchy></hierarchy>")).toEqual([]);
  expect(parseSnapshot('<node text="cut off')).toEqual([]);
  expect(parseSnapshot("<node")).toEqual([]);
});

test("more than 200 elements are cut to 200", () => {
  const many = Array.from({ length: 5000 }, (_, i) => node({ text: `n${i}` }));
  const elements = parseSnapshot(hierarchy(...many));
  expect(elements).toHaveLength(MAX_ELEMENTS);
  expect(elements.at(-1)?.ref).toBe("@a200");
});

test("the Settings dump from a real device gives named, tappable rows", () => {
  const elements = parseSnapshot(fixture("settings.xml"));
  expect(elements.length).toBeGreaterThan(5);
  expect(elements.length).toBeLessThanOrEqual(47);
  expect(elements.some((e) => e.text === "Network & internet")).toBe(true);
  expect(elements.every((e) => /^@a\d+$/.test(e.ref))).toBe(true);
});

test("the launcher dump parses without throwing", () => {
  expect(parseSnapshot(fixture("launcher.xml")).length).toBeGreaterThan(0);
});

test("snapshotText puts one element per line", () => {
  const elements = parseSnapshot(
    hierarchy(
      node({ text: "x" }),
      node({ text: "y" }),
      node({ text: "Network &amp; internet", "resource-id": "a:id/title", clickable: "true" }),
      node({ "content-desc": "Back", clickable: "true" }),
      node({ "resource-id": "a:id/list", scrollable: "true" }),
    ),
  );
  expect(
    snapshotText({ packageName: "com.android.settings", activity: ".Settings", elements }),
  ).toBe(
    [
      "App: com.android.settings/.Settings",
      '@a1 "x"',
      '@a2 "y"',
      '@a3 "Network & internet" [button] id=a:id/title',
      '@a4 "Back" [button]',
      "@a5 [scroll] id=a:id/list",
    ].join("\n"),
  );
});

test("snapshotText says so when nothing is on the screen and when the app is unknown", () => {
  expect(snapshotText({ packageName: null, activity: null, elements: [] })).toBe(
    "App: unknown\n(no elements on the screen)",
  );
});
