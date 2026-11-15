import { expect, test } from "vitest";
import {
  belongsToSite,
  cookieKey,
  fromChromium,
  isExpired,
  siteFrom,
  type ProfileCookie,
} from "./profile-cookie.js";

const reported = {
  name: "sid",
  value: "abc",
  domain: ".shop.test",
  path: "/",
  expires: 1_800_003_600.5,
  size: 6,
  httpOnly: true,
  secure: true,
  session: false,
  sameSite: "Lax",
  priority: "Medium",
  sameParty: false,
  sourceScheme: "Secure",
  sourcePort: 443,
};

test("a cookie Chromium reports becomes one it takes back", () => {
  expect(fromChromium(reported)).toEqual({
    name: "sid",
    value: "abc",
    domain: ".shop.test",
    path: "/",
    expires: 1_800_003_600.5,
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    priority: "Medium",
    sourceScheme: "Secure",
    sourcePort: 443,
  });
});

test("a session cookie has no expiry, and a partition key is kept only as an object", () => {
  const session = fromChromium({ ...reported, session: true, expires: -1 });
  const partitioned = fromChromium({
    ...reported,
    partitionKey: { topLevelSite: "https://top.test", hasCrossSiteAncestor: true },
  });
  const old = fromChromium({ ...reported, partitionKey: "https://top.test" });

  expect(session).not.toHaveProperty("expires");
  expect(partitioned?.partitionKey).toEqual({
    topLevelSite: "https://top.test",
    hasCrossSiteAncestor: true,
  });
  expect(old).not.toHaveProperty("partitionKey");
});

test("what is not a cookie is null", () => {
  expect(fromChromium(null)).toBeNull();
  expect(fromChromium({ ...reported, name: 7 })).toBeNull();
  expect(fromChromium({ ...reported, sameSite: "Sometimes" })).toBeNull();
});

test("a cookie's key is its name, domain, path and partition", () => {
  const cookie = fromChromium(reported) as ProfileCookie;
  const partition = { topLevelSite: "https://top.test", hasCrossSiteAncestor: false };

  expect(cookieKey(cookie)).toBe(cookieKey({ ...cookie, value: "other", secure: false }));
  expect(cookieKey(cookie)).not.toBe(cookieKey({ ...cookie, path: "/account" }));
  expect(cookieKey(cookie)).not.toBe(cookieKey({ ...cookie, domain: "shop.test" }));
  expect(cookieKey(cookie)).not.toBe(cookieKey({ ...cookie, partitionKey: partition }));
});

test("a cookie is expired from its expiry on, and a session cookie never", () => {
  const cookie = fromChromium(reported) as ProfileCookie;
  const { expires: _expires, ...session } = cookie;

  expect(isExpired(cookie, 1_800_003_600)).toBe(false);
  expect(isExpired(cookie, 1_800_003_601)).toBe(true);
  expect(isExpired(session, Number.MAX_SAFE_INTEGER)).toBe(false);
});

test.each([
  ["github.com", "github.com"],
  ["  GitHub.com ", "github.com"],
  ["https://github.com/login?next=1", "github.com"],
  [".github.com", "github.com"],
  ["localhost:3000", "localhost"],
  ["http://127.0.0.1:8080/x", "127.0.0.1"],
])("the site in %j is %s", (input, site) => {
  expect(siteFrom(input)).toBe(site);
});

test.each(["", "   ", "two words", "https://", "a_b.test", "-a.test"])(
  "%j names no site",
  (input) => {
    expect(siteFrom(input)).toBeNull();
  },
);

test("a cookie belongs to its site and to the sites above it, and to no look-alike", () => {
  expect(belongsToSite({ domain: ".github.com" }, "github.com")).toBe(true);
  expect(belongsToSite({ domain: "api.github.com" }, "github.com")).toBe(true);
  expect(belongsToSite({ domain: "GitHub.com" }, "github.com")).toBe(true);
  expect(belongsToSite({ domain: "notgithub.com" }, "github.com")).toBe(false);
  expect(belongsToSite({ domain: "github.com" }, "api.github.com")).toBe(false);
});
