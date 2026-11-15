import { afterEach, describe, expect, it, vi } from "vitest";
import {
  brandResources,
  brandText,
  branded,
  getBrand,
  parseBrand,
  resetBrandForTests,
  withBrand,
} from "./brand";

const GLOBAL_KEY = "__PASEO_BRAND__";
const page = globalThis as Record<string, unknown>;

afterEach(() => {
  delete page[GLOBAL_KEY];
  resetBrandForTests();
  vi.resetModules();
});

describe("the page's brand", () => {
  it("is what the daemon wrote, and nothing else", () => {
    expect(
      parseBrand({ name: "Acme", logoUrl: "/_brand/logo?v=1", iconUrl: "/_brand/icon.png?v=2" }),
    ).toEqual({ name: "Acme", logoUrl: "/_brand/logo?v=1", iconUrl: "/_brand/icon.png?v=2" });
    expect(parseBrand({ name: "Acme", logoUrl: null })).toEqual({
      name: "Acme",
      logoUrl: null,
      iconUrl: null,
    });
    expect(parseBrand({ name: null, logoUrl: "/_brand/logo" })).toEqual({
      name: null,
      logoUrl: "/_brand/logo",
      iconUrl: null,
    });
    expect(parseBrand({ iconUrl: "/_brand/icon.png" })).toEqual({
      name: null,
      logoUrl: null,
      iconUrl: "/_brand/icon.png",
    });
    // A logo is the serving daemon's own file: another address is not taken.
    expect(
      parseBrand({
        name: "Acme",
        logoUrl: "https://elsewhere.test/logo.svg",
        iconUrl: "//elsewhere.test/icon.png",
      }),
    ).toEqual({ name: "Acme", logoUrl: null, iconUrl: null });
    expect(parseBrand({ name: "  ", logoUrl: 7 })).toBeNull();
    expect(parseBrand(undefined)).toBeNull();
    expect(parseBrand("Acme")).toBeNull();
  });

  it("is read once from the page", () => {
    expect(getBrand()).toBeNull();
    resetBrandForTests();
    page[GLOBAL_KEY] = { name: "Acme", logoUrl: null };

    expect(getBrand()).toEqual({ name: "Acme", logoUrl: null, iconUrl: null });
    page[GLOBAL_KEY] = { name: "Other", logoUrl: null };
    expect(getBrand()?.name).toBe("Acme");
  });
});

describe("the brand's name in the app's text", () => {
  it("stands where the product is named, and nowhere else", () => {
    expect(brandText("Welcome to Paseo", "Acme")).toBe("Welcome to Acme");
    expect(brandText("Paseo's daemon. Paseo.", "Acme")).toBe("Acme's daemon. Acme.");
    // Commands, paths and addresses keep the product's own spelling.
    expect(brandText("Run paseo daemon start, see paseo.sh and ~/.paseo", "Acme")).toBe(
      "Run paseo daemon start, see paseo.sh and ~/.paseo",
    );
    expect(brandText("PaseoHub and $PASEO_PORT", "Acme")).toBe("PaseoHub and $PASEO_PORT");
    expect(brandText("Paseo を開く", "Acme")).toBe("Acme を開く");
    // A "$" in the name is written as it is.
    expect(brandText("Open Paseo", "Cost $& Co")).toBe("Open Cost $& Co");
  });

  it("is replaced in every string of a language, and the keys are left alone", () => {
    const resources = {
      Paseo: "Paseo",
      nested: { title: "Quitting Paseo...", count_one: "called Paseo {{count}} time" },
      list: ["Paseo", "other"],
      number: 3,
    };

    expect(brandResources(resources, "Acme")).toEqual({
      Paseo: "Acme",
      nested: { title: "Quitting Acme...", count_one: "called Acme {{count}} time" },
      list: ["Acme", "other"],
      number: 3,
    });
    // The language's own object is not changed: another page has no brand.
    expect(resources.nested.title).toBe("Quitting Paseo...");
  });

  it("leaves a language as it is without a brand name", () => {
    const resources = { title: "Welcome to Paseo" };

    expect(withBrand(resources)).toBe(resources);
    resetBrandForTests();
    page[GLOBAL_KEY] = { name: null, logoUrl: "/_brand/logo" };
    expect(withBrand(resources)).toBe(resources);
    resetBrandForTests();
    page[GLOBAL_KEY] = { name: "Acme", logoUrl: null };
    expect(withBrand(resources)).toEqual({ title: "Welcome to Acme" });
  });

  it("is replaced in a string written outside the translations", () => {
    expect(branded("Update Paseo to recover this workspace.")).toBe(
      "Update Paseo to recover this workspace.",
    );
    resetBrandForTests();
    page[GLOBAL_KEY] = { name: "Acme", logoUrl: null };

    expect(branded("Update Paseo to recover this workspace.")).toBe(
      "Update Acme to recover this workspace.",
    );
  });
});

describe("the app's translations under a brand", () => {
  it("say the brand's name in every language, and the credit still names the product", async () => {
    page[GLOBAL_KEY] = { name: "Acme", logoUrl: null };
    const { i18n } = await import("../i18n/i18next");
    const { PRODUCT_NAME } = await import("./brand");

    expect(i18n.t("sidebar.help.appName")).toBe("Acme");
    expect(i18n.t("brand.basedOn", { product: PRODUCT_NAME })).toBe("Based on Paseo");
    await i18n.changeLanguage("fr");
    expect(i18n.t("sidebar.help.appName")).toBe("Acme");
    expect(i18n.t("startup.errorTitle")).not.toContain("Paseo");
    await i18n.changeLanguage("en");
  });

  it("say Paseo without one", async () => {
    const { i18n } = await import("../i18n/i18next");

    expect(i18n.t("sidebar.help.appName")).toBe("Paseo");
  });
});
