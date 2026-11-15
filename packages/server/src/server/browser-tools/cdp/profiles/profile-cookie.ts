import { z } from "zod";

/** A cookie as `Storage.setCookies` takes it, which is also how a profile's cookies are stored. */
export const ProfileCookieSchema = z.object({
  name: z.string(),
  value: z.string(),
  /** A leading dot means the cookie is sent to subdomains too. */
  domain: z.string(),
  path: z.string(),
  secure: z.boolean(),
  httpOnly: z.boolean(),
  sameSite: z.enum(["Strict", "Lax", "None"]).optional(),
  /** Seconds since the epoch. Absent on a session cookie. */
  expires: z.number().optional(),
  priority: z.enum(["Low", "Medium", "High"]).optional(),
  sourceScheme: z.enum(["Unset", "NonSecure", "Secure"]).optional(),
  sourcePort: z.number().int().optional(),
  partitionKey: z
    .object({ topLevelSite: z.string(), hasCrossSiteAncestor: z.boolean() })
    .optional(),
});
export type ProfileCookie = z.infer<typeof ProfileCookieSchema>;

/** What `Storage.getCookies` reports: the stored fields, plus some that cannot be set. */
const ChromiumCookieSchema = ProfileCookieSchema.extend({
  expires: z.number(),
  session: z.boolean().optional(),
  // Chromium before 119 reports a string here, which setCookies of that age does not take back.
  partitionKey: z.unknown().optional(),
});

/** One cookie from `Storage.getCookies`, or null when it is not a cookie this code can store. */
export function fromChromium(raw: unknown): ProfileCookie | null {
  const parsed = ChromiumCookieSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { expires, session, partitionKey, ...rest } = parsed.data;
  const key = ProfileCookieSchema.shape.partitionKey.safeParse(partitionKey);
  return {
    ...rest,
    ...(session !== true && expires > 0 ? { expires } : {}),
    ...(key.success && key.data ? { partitionKey: key.data } : {}),
  };
}

/** Two cookies with one key are one cookie: setting the second replaces the first. */
export function cookieKey(cookie: ProfileCookie): string {
  return [cookie.name, cookie.domain, cookie.path, cookie.partitionKey?.topLevelSite ?? ""].join(
    "\n",
  );
}

/** The host a cookie belongs to, without the dot that marks a domain cookie. */
export function cookieHost(cookie: Pick<ProfileCookie, "domain">): string {
  return cookie.domain.replace(/^\./, "").toLowerCase();
}

export function isExpired(cookie: ProfileCookie, nowSeconds: number): boolean {
  return cookie.expires !== undefined && cookie.expires <= nowSeconds;
}

const HOST = /^(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[[0-9a-f:.]+\])$/;

export function isHost(value: string): boolean {
  return HOST.test(value);
}

/**
 * The site a person typed, as a host: "https://GitHub.com/login" and ".github.com" are both
 * "github.com". Null when it names no host.
 */
export function siteFrom(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (trimmed === "") return null;
  const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  const host = withoutScheme.split(/[/?#]/)[0].replace(/:\d+$/, "").replace(/^\./, "");
  return isHost(host) ? host : null;
}

/** Whether a cookie belongs to the site or to a host under it. */
export function belongsToSite(cookie: Pick<ProfileCookie, "domain">, site: string): boolean {
  const host = cookieHost(cookie);
  return host === site || host.endsWith(`.${site}`);
}
