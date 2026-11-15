import { describe, expect, test } from "vitest";
import {
  COOKIE_MAX_COUNT,
  COOKIE_TEXT_MAX_BYTES,
  CookieFileError,
  parseCookieText,
} from "./cookie-file.js";

const NOW = 1_800_000_000;
const LATER = NOW + 3600;

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof CookieFileError) return error.code;
    throw error;
  }
  return "no error";
}

describe("a JSON export", () => {
  test("a browser extension's array is read, with its own names for the fields", () => {
    const text = JSON.stringify([
      {
        domain: ".shop.test",
        expirationDate: LATER + 0.5,
        hostOnly: false,
        httpOnly: true,
        name: "sid",
        path: "/",
        sameSite: "no_restriction",
        secure: true,
        session: false,
        storeId: "0",
        value: "abc",
      },
      {
        domain: "shop.test",
        hostOnly: true,
        httpOnly: false,
        name: "theme",
        path: "/account",
        sameSite: "unspecified",
        secure: false,
        session: true,
        value: "",
      },
    ]);

    expect(parseCookieText(text, NOW)).toEqual({
      cookies: [
        {
          name: "sid",
          value: "abc",
          domain: ".shop.test",
          path: "/",
          secure: true,
          httpOnly: true,
          sameSite: "None",
          expires: LATER + 0.5,
        },
        {
          name: "theme",
          value: "",
          domain: "shop.test",
          path: "/account",
          secure: false,
          httpOnly: false,
        },
      ],
      skipped: 0,
    });
  });

  test("a Playwright storage state is read, and -1 is a session cookie", () => {
    const text = JSON.stringify({
      cookies: [
        {
          name: "sid",
          value: "abc",
          domain: "shop.test",
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
        },
      ],
      origins: [],
    });

    expect(parseCookieText(text, NOW).cookies).toEqual([
      {
        name: "sid",
        value: "abc",
        domain: "shop.test",
        path: "/",
        secure: true,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
  });

  test("hostOnly decides who gets the cookie when it disagrees with the dot", () => {
    const entry = { name: "a", value: "1", path: "/" };
    const text = JSON.stringify([
      { ...entry, domain: "shop.test", hostOnly: false },
      { ...entry, name: "b", domain: ".shop.test", hostOnly: true },
      { ...entry, name: "c", domain: ".Shop.Test" },
    ]);

    expect(parseCookieText(text, NOW).cookies.map((cookie) => cookie.domain)).toEqual([
      ".shop.test",
      "shop.test",
      ".shop.test",
    ]);
  });

  test("an expiry in milliseconds or as a date is read as that moment", () => {
    const entry = { value: "1", domain: "shop.test" };
    const text = JSON.stringify([
      { ...entry, name: "ms", expires: LATER * 1000 },
      { ...entry, name: "date", expires: new Date(LATER * 1000).toISOString() },
      { ...entry, name: "text", expiry: String(LATER) },
    ]);

    expect(parseCookieText(text, NOW).cookies.map((cookie) => cookie.expires)).toEqual([
      LATER,
      LATER,
      LATER,
    ]);
  });

  test("what Chromium would refuse is skipped, and the rest is kept", () => {
    const good = { name: "ok", value: "1", domain: "shop.test", path: "/" };
    const text = JSON.stringify([
      good,
      "not an object",
      { ...good, name: "" },
      { ...good, name: "two words" },
      { ...good, value: "a;b" },
      { ...good, value: 7 },
      { ...good, domain: "shop.test/path" },
      { ...good, domain: undefined },
      { ...good, path: "no-slash" },
      { ...good, expires: "next week" },
      { ...good, name: "old", expires: NOW - 1 },
      { ...good, name: "__Secure-x", secure: false },
      { ...good, name: "__Host-x", secure: true, domain: ".shop.test" },
      { ...good, name: "__Host-ok", secure: true },
    ]);

    const parsed = parseCookieText(text, NOW);

    expect(parsed.cookies.map((cookie) => cookie.name)).toEqual(["ok", "__Host-ok"]);
    expect(parsed.skipped).toBe(12);
  });

  test("SameSite=None without Secure is left to the default, which Chromium keeps", () => {
    const text = JSON.stringify([
      { name: "a", value: "1", domain: "shop.test", sameSite: "None", secure: false },
    ]);

    expect(parseCookieText(text, NOW).cookies[0]).not.toHaveProperty("sameSite");
  });
});

describe("a Netscape cookies.txt", () => {
  test("its lines are read: subdomain flag, secure, expiry, the HttpOnly prefix, comments", () => {
    const text = [
      "# Netscape HTTP Cookie File",
      "# This is a generated file! Do not edit.",
      "",
      `.shop.test\tTRUE\t/\tTRUE\t${LATER}\tsid\tabc`,
      `#HttpOnly_shop.test\tFALSE\t/account\tFALSE\t0\ttheme\tdark mode`,
      `shop.test\tFALSE\t/\tFALSE\t0\tempty`,
      "",
    ].join("\r\n");

    expect(parseCookieText(text, NOW)).toEqual({
      cookies: [
        {
          name: "sid",
          value: "abc",
          domain: ".shop.test",
          path: "/",
          secure: true,
          httpOnly: false,
          expires: LATER,
        },
        {
          name: "theme",
          value: "dark mode",
          domain: "shop.test",
          path: "/account",
          secure: false,
          httpOnly: true,
        },
        {
          name: "empty",
          value: "",
          domain: "shop.test",
          path: "/",
          secure: false,
          httpOnly: false,
        },
      ],
      skipped: 0,
    });
  });

  test("an expired line is skipped", () => {
    const text = [
      `shop.test\tFALSE\t/\tFALSE\t${NOW - 10}\told\t1`,
      `shop.test\tFALSE\t/\tFALSE\t${LATER}\tnew\t1`,
    ].join("\n");

    const parsed = parseCookieText(text, NOW);

    expect(parsed.cookies.map((cookie) => cookie.name)).toEqual(["new"]);
    expect(parsed.skipped).toBe(1);
  });
});

describe("text that is not a cookie file", () => {
  test.each([
    ["plain words", "these are my cookies"],
    ["broken JSON", '[{"name": "a"'],
    ["a JSON object with no cookies", '{"origins": []}'],
    ["a JSON string", '"cookies"'],
    ["nothing", "   \n"],
    ["only comments", "# Netscape HTTP Cookie File\n"],
  ])("%s is unreadable", (_label, text) => {
    expect(codeOf(() => parseCookieText(text, NOW))).toBe("browser_cookies_unreadable");
  });

  test("a file whose every cookie is refused or expired has none", () => {
    const text = JSON.stringify([{ name: "old", value: "1", domain: "shop.test", expires: 5 }]);

    expect(codeOf(() => parseCookieText(text, NOW))).toBe("browser_cookies_none");
    expect(codeOf(() => parseCookieText("[]", NOW))).toBe("browser_cookies_none");
  });

  test("text over the size limit, or with too many cookies, is too large", () => {
    const big = "x".repeat(COOKIE_TEXT_MAX_BYTES + 1);
    const many = JSON.stringify(
      Array.from({ length: COOKIE_MAX_COUNT + 1 }, (_unused, index) => ({
        name: `c${index}`,
        value: "",
        domain: "a.test",
      })),
    );

    expect(codeOf(() => parseCookieText(big, NOW))).toBe("browser_cookies_too_large");
    expect(codeOf(() => parseCookieText(many, NOW))).toBe("browser_cookies_too_large");
  });

  test("the error never carries the text", () => {
    const secret = '[{"name": "sid", "value": "s3cret"';

    try {
      parseCookieText(secret, NOW);
    } catch (error) {
      expect(String(error)).not.toContain("s3cret");
      expect(JSON.stringify(error)).not.toContain("s3cret");
    }
  });
});
