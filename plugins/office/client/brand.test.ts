import { expect, test } from "vitest";
import { parseBrand } from "./brand.js";

const PAGE = "https://office.example/h/local/plugin/office/surface/office";

test("the page's brand has its name and its logo's address in full", () => {
  expect(
    parseBrand(
      { name: "Flavours", logoUrl: "/_brand/logo.svg", iconUrl: "/_brand/icon.png" },
      PAGE,
    ),
  ).toEqual({ name: "Flavours", logoUrl: "https://office.example/_brand/logo.svg" });
});

test("a name alone and a logo alone are each a brand", () => {
  expect(parseBrand({ name: "Flavours" }, PAGE)).toEqual({ name: "Flavours", logoUrl: null });
  expect(parseBrand({ logoUrl: "/_brand/logo.png" }, PAGE)).toEqual({
    name: null,
    logoUrl: "https://office.example/_brand/logo.png",
  });
});

test("anything else is no brand", () => {
  const not = [
    undefined,
    null,
    "Flavours",
    3,
    {},
    { name: "  " },
    { name: 3 },
    { logoUrl: "https://elsewhere.example/logo.svg" },
    { logoUrl: "//elsewhere.example/_brand/logo.svg" },
  ];
  for (const value of not) expect(parseBrand(value, PAGE)).toBeNull();
});
