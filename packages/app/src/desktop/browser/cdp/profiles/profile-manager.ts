import type {
  CdpBrowserCookieImportResult,
  CdpBrowserCookieSource,
  CdpBrowserProfile,
} from "@getpaseo/protocol/browser-automation/cdp-view-schemas";

/** The daemon refuses a larger import text; a file over this is not sent at all. */
export const COOKIE_TEXT_MAX_BYTES = 1024 * 1024;

/** What the sheet asks of the host, already bound to its workspace. */
export interface ProfileApi {
  list(): Promise<{ profiles: CdpBrowserProfile[]; workspaceProfileId: string | null }>;
  create(name: string): Promise<CdpBrowserProfile>;
  remove(profileId: string): Promise<void>;
  /** Null is the Shared profile. */
  assign(profileId: string | null): Promise<void>;
  importCookies(
    profileId: string,
    source: CdpBrowserCookieSource,
  ): Promise<CdpBrowserCookieImportResult>;
}

export type ProfileCommand = "choose" | "add" | "remove" | "import";

export interface ProfileManagerState {
  /** `failed` is a list that could not be read; `error` then says why. */
  status: "loading" | "ready" | "failed";
  profiles: readonly CdpBrowserProfile[];
  /** The profile the workspace's new tabs open in; null is Shared. */
  chosenId: string | null;
  /** The command that runs. No other starts until it ends. */
  busy: ProfileCommand | null;
  /** The daemon's code for the last failure. A new command clears it. */
  error: string | null;
  /** What the last import did, until another starts or the result is cleared. */
  imported: CdpBrowserCookieImportResult | null;
}

export interface ProfileManager {
  getState(): ProfileManagerState;
  load(): Promise<void>;
  choose(profileId: string | null): Promise<void>;
  /** Resolves true when the profile was made. */
  add(name: string): Promise<boolean>;
  remove(profileId: string): Promise<void>;
  importCookies(profileId: string, source: CdpBrowserCookieSource): Promise<void>;
  /** Forgets the last import's result and the last failure. */
  clearResult(): void;
  /** Results that arrive after this change nothing. */
  stop(): void;
}

/** Before the list arrived. */
export const INITIAL_PROFILE_STATE: ProfileManagerState = {
  status: "loading",
  profiles: [],
  chosenId: null,
  busy: null,
  error: null,
  imported: null,
};

/** The daemon's code travels as the error's message. */
function codeOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "browser_unknown_error";
}

export function createProfileManager(input: {
  api: ProfileApi;
  onState(state: ProfileManagerState): void;
}): ProfileManager {
  const { api, onState } = input;
  let state = INITIAL_PROFILE_STATE;
  let stopped = false;

  function publish(next: Partial<ProfileManagerState>): void {
    if (stopped) return;
    state = { ...state, ...next };
    onState(state);
  }

  /** Runs one command at a time; its failure becomes the state's error. */
  async function run(command: ProfileCommand, work: () => Promise<void>): Promise<boolean> {
    if (state.status !== "ready" || state.busy !== null) return false;
    publish({ busy: command, error: null, imported: null });
    try {
      await work();
      publish({ busy: null });
      return true;
    } catch (error) {
      publish({ busy: null, error: codeOf(error) });
      return false;
    }
  }

  return {
    getState: () => state,
    async load() {
      publish({ status: "loading", error: null });
      try {
        const listed = await api.list();
        publish({
          status: "ready",
          profiles: listed.profiles,
          chosenId: listed.workspaceProfileId,
        });
      } catch (error) {
        publish({ status: "failed", error: codeOf(error) });
      }
    },
    async choose(profileId) {
      const previous = state.chosenId;
      if (profileId === previous) return;
      await run("choose", async () => {
        // Shown at once; a refusal puts the old choice back.
        publish({ chosenId: profileId });
        try {
          await api.assign(profileId);
        } catch (error) {
          publish({ chosenId: previous });
          throw error;
        }
      });
    },
    add(name) {
      return run("add", async () => {
        const profile = await api.create(name);
        publish({ profiles: [...state.profiles, profile] });
      });
    },
    async remove(profileId) {
      await run("remove", async () => {
        await api.remove(profileId);
        publish({
          profiles: state.profiles.filter((profile) => profile.id !== profileId),
          // The daemon puts the profile's workspaces back on Shared.
          chosenId: state.chosenId === profileId ? null : state.chosenId,
        });
      });
    },
    async importCookies(profileId, source) {
      await run("import", async () => {
        publish({ imported: await api.importCookies(profileId, source) });
      });
    },
    clearResult() {
      publish({ error: null, imported: null });
    },
    stop() {
      stopped = true;
    },
  };
}

/** The sites in what a person typed: separated by commas, spaces or new lines. */
export function sitesIn(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((site) => site.trim())
    .filter((site) => site !== "");
}

/** The i18n keys for the daemon's codes; any other code reads as a general failure. */
const ERROR_KEYS = {
  browser_no_host: "cdpBrowser.profiles.errors.noHost",
  browser_profile_not_found: "cdpBrowser.profiles.errors.notFound",
  browser_profile_name_invalid: "cdpBrowser.profiles.errors.nameInvalid",
  browser_profile_name_taken: "cdpBrowser.profiles.errors.nameTaken",
  browser_profile_limit: "cdpBrowser.profiles.errors.limit",
  browser_cookies_unreadable: "cdpBrowser.profiles.errors.cookiesUnreadable",
  browser_cookies_none: "cdpBrowser.profiles.errors.cookiesNone",
  browser_cookies_too_large: "cdpBrowser.profiles.errors.cookiesTooLarge",
} as const;

export type ProfileErrorKey =
  | (typeof ERROR_KEYS)[keyof typeof ERROR_KEYS]
  | "cdpBrowser.profiles.errors.unknown";

export function profileErrorKey(code: string): ProfileErrorKey {
  // Its own keys only: "toString" is in every object.
  return Object.hasOwn(ERROR_KEYS, code)
    ? ERROR_KEYS[code as keyof typeof ERROR_KEYS]
    : "cdpBrowser.profiles.errors.unknown";
}

/** "12 KB" for a picked file's size. */
export function fileSizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
