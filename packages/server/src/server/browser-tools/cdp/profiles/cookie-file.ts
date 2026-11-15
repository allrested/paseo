import { hasControlCharacter, hasSpaceOrControlCharacter } from "./characters.js";
import { isExpired, isHost, type ProfileCookie } from "./profile-cookie.js";

export const COOKIE_TEXT_MAX_BYTES = 1024 * 1024;
export const COOKIE_MAX_COUNT = 5000;

export type CookieFileErrorCode =
  | "browser_cookies_unreadable"
  | "browser_cookies_none"
  | "browser_cookies_too_large";

/** The import text holds no cookies this code can use. The message never quotes the text. */
export class CookieFileError extends Error {
  constructor(public readonly code: CookieFileErrorCode) {
    super(code);
    this.name = "CookieFileError";
  }
}

export interface ParsedCookies {
  cookies: ProfileCookie[];
  /** Entries that are not a cookie Chromium would take, or that expired. */
  skipped: number;
}

/** A cookie as an export writes it, before any field is trusted. */
interface Draft {
  name: unknown;
  value: unknown;
  domain: unknown;
  path: unknown;
  secure: unknown;
  httpOnly: unknown;
  sameSite: unknown;
  expires: unknown;
  /** Set by exports that say whether subdomains get the cookie; the domain's dot says it otherwise. */
  hostOnly?: boolean;
}

// No control character, and none of the characters that end a name or a value in a header.
function isName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value !== "" &&
    !hasSpaceOrControlCharacter(value) &&
    !/[;=]/.test(value)
  );
}

function isValue(value: unknown): value is string {
  return typeof value === "string" && !hasControlCharacter(value) && !value.includes(";");
}

/** The cookie's path, "/" when the export names none, or null when it is not a path. */
function pathOf(value: unknown): string | null {
  if (value === undefined || value === null) return "/";
  return isValue(value) && value.startsWith("/") ? value : null;
}

/** Chromium refuses a prefixed name without the properties the prefix promises. */
function keepsPrefixPromise(
  cookie: Pick<ProfileCookie, "name" | "secure" | "path" | "domain">,
): boolean {
  if (cookie.name.startsWith("__Secure-")) return cookie.secure;
  if (cookie.name.startsWith("__Host-")) {
    return cookie.secure && cookie.path === "/" && !cookie.domain.startsWith(".");
  }
  return true;
}

const SAME_SITE: Record<string, ProfileCookie["sameSite"]> = {
  strict: "Strict",
  lax: "Lax",
  none: "None",
  no_restriction: "None",
};

/** Seconds since the epoch, or undefined for a session cookie, or null when it is neither. */
function expiryOf(value: unknown): number | undefined | null {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return expiryOf(numeric);
    const date = Date.parse(value);
    return Number.isNaN(date) ? null : date / 1000;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  // 0 and -1 are how exports write "ends with the session".
  if (value <= 0) return undefined;
  // Some exports write milliseconds; in seconds this would be past the year 5000.
  return value > 1e11 ? value / 1000 : value;
}

function domainOf(draft: Draft): string | null {
  if (typeof draft.domain !== "string") return null;
  const written = draft.domain.trim().toLowerCase();
  const host = written.replace(/^\./, "");
  if (!isHost(host)) return null;
  const forSubdomains = draft.hostOnly === undefined ? written.startsWith(".") : !draft.hostOnly;
  return forSubdomains ? `.${host}` : host;
}

/** Chromium drops a SameSite=None cookie that is not Secure; without it the cookie is Lax. */
function sameSiteOf(value: unknown, secure: boolean): ProfileCookie["sameSite"] {
  const sameSite = typeof value === "string" ? SAME_SITE[value.toLowerCase()] : undefined;
  return sameSite === "None" && !secure ? undefined : sameSite;
}

function toCookie(draft: Draft, nowSeconds: number): ProfileCookie | null {
  const { name, value } = draft;
  const domain = domainOf(draft);
  const path = pathOf(draft.path);
  const expires = expiryOf(draft.expires);
  if (!isName(name) || !isValue(value) || domain === null || path === null || expires === null) {
    return null;
  }
  const secure = draft.secure === true;
  const sameSite = sameSiteOf(draft.sameSite, secure);
  const cookie: ProfileCookie = {
    name,
    value,
    domain,
    path,
    secure,
    httpOnly: draft.httpOnly === true,
    ...(sameSite ? { sameSite } : {}),
    ...(expires === undefined ? {} : { expires }),
  };
  return keepsPrefixPromise(cookie) && !isExpired(cookie, nowSeconds) ? cookie : null;
}

function draftFromJson(entry: unknown): Draft | null {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return null;
  const fields = entry as Record<string, unknown>;
  return {
    name: fields.name,
    value: fields.value,
    domain: fields.domain,
    path: fields.path,
    secure: fields.secure,
    httpOnly: fields.httpOnly,
    sameSite: fields.sameSite,
    expires:
      fields.session === true
        ? undefined
        : (fields.expirationDate ?? fields.expires ?? fields.expiry),
    ...(typeof fields.hostOnly === "boolean" ? { hostOnly: fields.hostOnly } : {}),
  };
}

function jsonEntries(text: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CookieFileError("browser_cookies_unreadable");
  }
  if (Array.isArray(parsed)) return parsed;
  // A Playwright storage state.
  const cookies = (parsed as { cookies?: unknown } | null)?.cookies;
  if (Array.isArray(cookies)) return cookies;
  throw new CookieFileError("browser_cookies_unreadable");
}

const HTTP_ONLY_PREFIX = "#HttpOnly_";

/** The lines of a Netscape cookies.txt: seven tab-separated fields, the value last. */
function netscapeDrafts(text: string): Draft[] {
  const drafts: Draft[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const httpOnly = raw.startsWith(HTTP_ONLY_PREFIX);
    const line = httpOnly ? raw.slice(HTTP_ONLY_PREFIX.length) : raw;
    if (line.trim() === "" || line.startsWith("#")) continue;
    const fields = line.split("\t");
    // A cookie with an empty value is written with six fields by some tools.
    if (fields.length < 6) throw new CookieFileError("browser_cookies_unreadable");
    const [domain, forSubdomains, path, secure, expires, name] = fields;
    drafts.push({
      name,
      value: fields.slice(6).join("\t"),
      domain,
      path,
      secure: secure.toUpperCase() === "TRUE",
      httpOnly,
      sameSite: undefined,
      expires,
      hostOnly: forSubdomains.toUpperCase() !== "TRUE",
    });
  }
  if (drafts.length === 0) throw new CookieFileError("browser_cookies_unreadable");
  return drafts;
}

/**
 * The cookies in an import text: a JSON export (an array, or an object with a `cookies` array) or
 * a Netscape cookies.txt. Throws CookieFileError when the text is neither, is too large, or holds
 * no cookie that can be used.
 */
export function parseCookieText(text: string, nowSeconds: number): ParsedCookies {
  if (Buffer.byteLength(text, "utf8") > COOKIE_TEXT_MAX_BYTES) {
    throw new CookieFileError("browser_cookies_too_large");
  }
  const trimmed = text.trim();
  const isJson = trimmed.startsWith("[") || trimmed.startsWith("{");
  const drafts = isJson ? jsonEntries(trimmed).map(draftFromJson) : netscapeDrafts(text);
  if (drafts.length > COOKIE_MAX_COUNT) throw new CookieFileError("browser_cookies_too_large");
  const cookies: ProfileCookie[] = [];
  for (const draft of drafts) {
    const cookie = draft ? toCookie(draft, nowSeconds) : null;
    if (cookie) cookies.push(cookie);
  }
  if (cookies.length === 0) throw new CookieFileError("browser_cookies_none");
  return { cookies, skipped: drafts.length - cookies.length };
}
