import { createHash } from "node:crypto";
import type { Logger } from "pino";
import { CdpCommandError } from "../cdp-connection.js";
import { CdpUnreachableError } from "../cdp-endpoint.js";
import { CookieFileError, parseCookieText } from "./cookie-file.js";
import type { CdpCookieVault } from "./cookie-vault.js";
import {
  belongsToSite,
  cookieHost,
  cookieKey,
  fromChromium,
  isExpired,
  siteFrom,
  type ProfileCookie,
} from "./profile-cookie.js";
import { CdpProfileError, type CdpProfile, type CdpProfileStore } from "./profile-store.js";

/** How many site names an import answers with; the count says how many there are. */
export const IMPORT_SITES_SHOWN = 8;
export const SHARED_IMPORT_SITE_LIMIT = 20;

/** The browser socket, as far as profiles use it. */
export interface ProfileBrowser {
  send<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>): Promise<T>;
}

export interface CookieImportResult {
  /** Cookies Chromium kept. */
  imported: number;
  /** Entries that were not usable, had expired, or that Chromium refused. */
  skipped: number;
  /** The first sites the kept cookies belong to, in name order. */
  sites: string[];
  siteCount: number;
}

export interface CdpProfilesOptions {
  store: CdpProfileStore;
  vault: CdpCookieVault;
  logger: Pick<Logger, "debug" | "warn">;
  createId: () => string;
  now?: () => number;
}

/**
 * The named browser profiles while the daemon runs. A profile is a browser context in Chromium,
 * which Chromium keeps in memory alone: this makes the context when it is missing and gives it
 * the cookies the vault holds, and writes the cookies back down as they change.
 */
export class CdpProfiles {
  private readonly store: CdpProfileStore;
  private readonly vault: CdpCookieVault;
  private readonly logger: Pick<Logger, "debug" | "warn">;
  private readonly createId: () => string;
  private readonly now: () => number;

  private browser: ProfileBrowser | null = null;
  private loading: Promise<void> | null = null;
  /** Profile id to its live context. A context is listed once its stored cookies are in it. */
  private readonly contexts = new Map<string, string>();
  private readonly creating = new Map<string, Promise<string>>();
  private readonly saving = new Map<string, Promise<void>>();
  /** A digest of what the vault holds, so unchanged cookies are not written again. */
  private readonly lastSaved = new Map<string, string>();

  constructor(options: CdpProfilesOptions) {
    this.store = options.store;
    this.vault = options.vault;
    this.logger = options.logger;
    this.createId = options.createId;
    this.now = options.now ?? Date.now;
  }

  /** Reads the profile file once, however many callers ask. */
  load(): Promise<void> {
    this.loading ??= this.store.load();
    return this.loading;
  }

  /** Chromium answers. A context from before is kept only when Chromium still has it. */
  async connected(browser: ProfileBrowser): Promise<void> {
    this.contexts.clear();
    const live = await liveContexts(browser);
    for (const profile of this.store.list()) {
      if (profile.contextId === undefined) continue;
      if (live.has(profile.contextId)) this.contexts.set(profile.id, profile.contextId);
      else this.store.setContext(profile.id, null);
    }
    this.browser = browser;
  }

  disconnected(): void {
    this.browser = null;
    this.contexts.clear();
  }

  list(): CdpProfile[] {
    return this.store.list();
  }

  get(profileId: string): CdpProfile | null {
    return this.store.get(profileId);
  }

  /** The profile the workspace's new tabs open in; null is the Shared profile. */
  profileOf(workspaceId: string): CdpProfile | null {
    return this.store.profileOf(workspaceId);
  }

  create(name: string): CdpProfile {
    return this.store.create({ id: this.createId(), name, now: this.now() });
  }

  assign(workspaceId: string, profileId: string | null): void {
    this.store.assign(workspaceId, profileId);
  }

  /** The profile's live context, made and given its stored cookies when Chromium has none. */
  async contextFor(profileId: string): Promise<string> {
    const browser = this.requireBrowser();
    if (!this.store.get(profileId)) throw new CdpProfileError("browser_profile_not_found");
    const known = this.contexts.get(profileId);
    if (known !== undefined) {
      // Headful Chromium may drop a context whose last window closed.
      if ((await liveContexts(browser)).has(known)) return known;
      // Only the context that was checked is forgotten: another caller may have made one meanwhile.
      if (this.contexts.get(profileId) === known) this.forgetContext(profileId);
    }
    const current = this.contexts.get(profileId);
    if (current !== undefined) return current;
    const running = this.creating.get(profileId);
    if (running) return running;
    const create = this.createContext(browser, profileId).finally(() =>
      this.creating.delete(profileId),
    );
    this.creating.set(profileId, create);
    return create;
  }

  /**
   * Writes the profile's cookies down when they changed. A profile with no live context is left
   * alone: what the vault holds is the newest there is.
   */
  save(profileId: string): Promise<void> {
    // One at a time per profile, so an older read never lands on a newer one.
    const previous = this.saving.get(profileId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => this.saveNow(profileId));
    this.saving.set(profileId, next);
    return next;
  }

  /** Saves each profile; one that fails is logged and does not stop the others. */
  async saveAll(profileIds: Iterable<string>): Promise<void> {
    await Promise.all(
      [...new Set(profileIds)].map((profileId) =>
        this.save(profileId).catch((error: unknown) =>
          this.logger.debug({ err: error, profileId }, "Saving a browser profile's cookies failed"),
        ),
      ),
    );
  }

  /** Cookies from a cookie file's text. */
  async importText(profileId: string, text: string): Promise<CookieImportResult> {
    const parsed = parseCookieText(text, this.now() / 1000);
    return this.write(profileId, parsed.cookies, parsed.skipped);
  }

  /** The Shared profile's cookies for the sites named, and the hosts under them. */
  async importShared(profileId: string, sites: readonly string[]): Promise<CookieImportResult> {
    const browser = this.requireBrowser();
    if (!this.store.get(profileId)) throw new CdpProfileError("browser_profile_not_found");
    const wanted = sites.map(siteFrom);
    if (wanted.length === 0 || wanted.length > SHARED_IMPORT_SITE_LIMIT || wanted.includes(null)) {
      throw new CookieFileError("browser_cookies_unreadable");
    }
    const nowSeconds = this.now() / 1000;
    const shared = await readCookies(browser, null);
    const cookies = shared.filter(
      (cookie) =>
        !isExpired(cookie, nowSeconds) &&
        wanted.some((site) => site !== null && belongsToSite(cookie, site)),
    );
    if (cookies.length === 0) throw new CookieFileError("browser_cookies_none");
    return this.write(profileId, cookies, 0);
  }

  /** Closes the profile's context, which closes its tabs, and forgets its cookies. */
  async delete(profileId: string): Promise<void> {
    const browser = this.requireBrowser();
    // Out of the store first: a context being made for it then closes itself, and no save starts.
    if (!this.store.remove(profileId)) throw new CdpProfileError("browser_profile_not_found");
    await this.creating.get(profileId)?.catch(() => undefined);
    const contextId = this.contexts.get(profileId);
    this.forgetContext(profileId);
    if (contextId !== undefined) await dispose(browser, contextId);
    await this.saving.get(profileId)?.catch(() => undefined);
    this.saving.delete(profileId);
    await this.vault.remove(profileId);
  }

  flush(): Promise<void> {
    return this.store.flush();
  }

  private requireBrowser(): ProfileBrowser {
    if (!this.browser) throw new CdpUnreachableError("The Docker browser is unreachable.");
    return this.browser;
  }

  private forgetContext(profileId: string): void {
    this.contexts.delete(profileId);
    this.store.setContext(profileId, null);
  }

  private async createContext(browser: ProfileBrowser, profileId: string): Promise<string> {
    const { browserContextId } = await browser.send<{ browserContextId: string }>(
      "Target.createBrowserContext",
      { disposeOnDetach: false },
    );
    try {
      const nowSeconds = this.now() / 1000;
      const stored = (await this.storedCookies(profileId)).filter(
        (cookie) => !isExpired(cookie, nowSeconds),
      );
      if (stored.length > 0) await setCookies(browser, browserContextId, stored);
    } catch (error) {
      // A context without its cookies would be saved over the stored ones.
      await dispose(browser, browserContextId);
      throw error;
    }
    if (!this.store.get(profileId)) {
      await dispose(browser, browserContextId);
      throw new CdpProfileError("browser_profile_not_found");
    }
    this.contexts.set(profileId, browserContextId);
    this.store.setContext(profileId, browserContextId);
    return browserContextId;
  }

  /** A vault file that cannot be read is logged, and the profile starts without cookies. */
  private async storedCookies(profileId: string): Promise<ProfileCookie[]> {
    try {
      return await this.vault.read(profileId);
    } catch (error) {
      this.logger.warn({ err: error, profileId }, "A browser profile's stored cookies are lost");
      return [];
    }
  }

  private async saveNow(profileId: string): Promise<void> {
    const browser = this.browser;
    const contextId = this.contexts.get(profileId);
    if (!browser || contextId === undefined) return;
    let cookies: ProfileCookie[];
    try {
      cookies = await readCookies(browser, contextId);
    } catch (error) {
      if (!(error instanceof CdpCommandError)) throw error;
      // Chromium dropped the context, and its cookies with it: what the vault holds stands.
      if (this.contexts.get(profileId) === contextId) this.forgetContext(profileId);
      return;
    }
    const ordered = cookies.toSorted((left, right) =>
      cookieKey(left).localeCompare(cookieKey(right)),
    );
    const digest = createHash("sha256").update(JSON.stringify(ordered)).digest("hex");
    if (this.lastSaved.get(profileId) === digest || !this.store.get(profileId)) return;
    await this.vault.write(profileId, ordered);
    this.lastSaved.set(profileId, digest);
  }

  private async write(
    profileId: string,
    cookies: readonly ProfileCookie[],
    skipped: number,
  ): Promise<CookieImportResult> {
    const browser = this.requireBrowser();
    const contextId = await this.contextFor(profileId);
    await setCookies(browser, contextId, cookies);
    // Chromium drops some cookies without an error, so what it kept is read back and counted.
    const kept = new Set((await readCookies(browser, contextId)).map(cookieKey));
    const imported = cookies.filter((cookie) => kept.has(cookieKey(cookie)));
    if (imported.length === 0) throw new CookieFileError("browser_cookies_none");
    await this.save(profileId);
    const hosts = [...new Set(imported.map(cookieHost))].toSorted();
    return {
      imported: imported.length,
      skipped: skipped + cookies.length - imported.length,
      sites: hosts.slice(0, IMPORT_SITES_SHOWN),
      siteCount: hosts.length,
    };
  }
}

async function liveContexts(browser: ProfileBrowser): Promise<Set<string>> {
  const { browserContextIds } = await browser.send<{ browserContextIds?: string[] }>(
    "Target.getBrowserContexts",
  );
  return new Set(browserContextIds ?? []);
}

/** Null is Chromium's own profile, which the Shared profile is. */
async function readCookies(
  browser: ProfileBrowser,
  contextId: string | null,
): Promise<ProfileCookie[]> {
  const { cookies } = await browser.send<{ cookies?: unknown[] }>(
    "Storage.getCookies",
    contextId === null ? {} : { browserContextId: contextId },
  );
  return (cookies ?? []).flatMap((raw) => fromChromium(raw) ?? []);
}

/** One cookie Chromium refuses fails its whole batch, so a failed batch is set again one by one. */
async function setCookies(
  browser: ProfileBrowser,
  contextId: string,
  cookies: readonly ProfileCookie[],
): Promise<void> {
  try {
    await browser.send("Storage.setCookies", { cookies, browserContextId: contextId });
    return;
  } catch (error) {
    if (!(error instanceof CdpCommandError)) throw error;
  }
  for (const cookie of cookies) {
    try {
      await browser.send("Storage.setCookies", { cookies: [cookie], browserContextId: contextId });
    } catch (error) {
      if (!(error instanceof CdpCommandError)) throw error;
    }
  }
}

/** A context Chromium no longer has is disposed already. */
async function dispose(browser: ProfileBrowser, contextId: string): Promise<void> {
  try {
    await browser.send("Target.disposeBrowserContext", { browserContextId: contextId });
  } catch (error) {
    if (!(error instanceof CdpCommandError)) throw error;
  }
}
