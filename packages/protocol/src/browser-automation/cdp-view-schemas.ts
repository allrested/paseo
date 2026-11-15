// Fork delta (web browser pane): the daemon-hosted Docker Chromium. Gate: server_info.features.cdpBrowser.
import { z } from "zod";

/**
 * The codes the daemon sends in the `error` field of every browser.cdp response and update.
 * The wire field stays `z.string()` so a newer daemon may add a code; the daemon types the
 * values it sends as `CdpBrowserErrorCode`.
 */
export const CDP_BROWSER_ERROR_CODES = [
  "browser_unsupported",
  "browser_no_host",
  "browser_tab_not_found",
  "browser_timeout",
  "browser_unknown_error",
  /** A navigate to a URL that is not http, https or about:blank. An older daemon sends browser_unknown_error. */
  "browser_url_refused",
  /** A pick_element on a page that is still loading: the page cannot be marked up yet. */
  "browser_page_loading",
  // The browser.cdp.profile.* codes. Gate: server_info.features.cdpBrowserProfiles.
  "browser_profile_not_found",
  /** Empty, longer than 40 characters, or with a control character. */
  "browser_profile_name_invalid",
  /** Another profile has the name, without regard to case, or it is the built-in's: Shared. */
  "browser_profile_name_taken",
  /** The daemon keeps at most 12 profiles. */
  "browser_profile_limit",
  /** The import text is not a cookie file, or the sites named are not sites. */
  "browser_cookies_unreadable",
  /** The import holds no cookie Chromium keeps: every one was unusable, expired or refused. */
  "browser_cookies_none",
  /** The import text is over 1 MiB or holds more than 5,000 cookies. */
  "browser_cookies_too_large",
] as const;
export type CdpBrowserErrorCode = (typeof CDP_BROWSER_ERROR_CODES)[number];

export const CdpBrowserTabStateSchema = z.object({
  browserId: z.string(),
  workspaceId: z.string(),
  url: z.string(),
  title: z.string(),
  isLoading: z.boolean(),
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
  /**
   * Daemon wall-clock time, epoch ms. Non-null while an agent used the tab in the last 3 s. Only
   * null versus non-null carries meaning: a client's clock may be skewed, so do not compare it.
   */
  agentActiveUntil: z.number().nullable(),
  /**
   * The named profile the tab opened in; null is the Shared profile, which is the Chromium's own.
   * Absent from a daemon without server_info.features.cdpBrowserProfiles.
   */
  profile: z.object({ id: z.string(), name: z.string() }).nullable().optional(),
});

export const CdpBrowserTabsEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("opened"), tab: CdpBrowserTabStateSchema }),
  z.object({ kind: z.literal("state"), tab: CdpBrowserTabStateSchema }),
  z.object({
    kind: z.literal("closed"),
    browserId: z.string(),
    workspaceId: z.string(),
    lastUrl: z.string(),
  }),
  z.object({ kind: z.literal("host"), connected: z.boolean() }),
]);

/**
 * The pane's size in CSS pixels and its device pixel ratio. The daemon clamps all three: width
 * 320-1920, height 240-1080, device pixel ratio 1-2.
 */
export const CdpBrowserViewportSchema = z.object({
  width: z.number(),
  height: z.number(),
  deviceScaleFactor: z.number(),
});

/** Coordinates are page CSS pixels. `modifiers` is the CDP bit mask: Alt 1, Control 2, Meta 4, Shift 8. */
export const CdpBrowserViewInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("mouse"),
    type: z.enum(["move", "down", "up"]),
    x: z.number(),
    y: z.number(),
    button: z.enum(["none", "left", "middle", "right"]),
    buttons: z.number().int(),
    clickCount: z.number().int(),
    modifiers: z.number().int(),
  }),
  z.object({
    kind: z.literal("wheel"),
    x: z.number(),
    y: z.number(),
    deltaX: z.number(),
    deltaY: z.number(),
    modifiers: z.number().int(),
  }),
  z.object({
    kind: z.literal("key"),
    type: z.enum(["down", "up"]),
    key: z.string(),
    code: z.string(),
    text: z.string().optional(),
    modifiers: z.number().int(),
  }),
  z.object({ kind: z.literal("text"), text: z.string() }),
  /**
   * Claims the tab's viewport with the request's `viewport` and sends nothing to the page. The pane
   * sends it when its size changes, so the first tap after a resize is not aimed at a stale frame.
   * The daemon ignores it while an agent's `browser_resize` holds the size; only real input ends that.
   */
  z.object({ kind: z.literal("resize") }),
]);

export const CdpBrowserNavigateActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("url"), url: z.string() }),
  z.object({ kind: z.literal("back") }),
  z.object({ kind: z.literal("forward") }),
  z.object({ kind: z.literal("reload") }),
]);

export const BrowserCdpTabOpenRequestSchema = z.object({
  type: z.literal("browser.cdp.tab.open.request"),
  requestId: z.string(),
  workspaceId: z.string(),
  url: z.string().optional(),
});
export const BrowserCdpTabOpenResponseSchema = z.object({
  type: z.literal("browser.cdp.tab.open.response"),
  payload: z.object({
    requestId: z.string(),
    tab: CdpBrowserTabStateSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const BrowserCdpTabCloseRequestSchema = z.object({
  type: z.literal("browser.cdp.tab.close.request"),
  requestId: z.string(),
  browserId: z.string(),
});
export const BrowserCdpTabCloseResponseSchema = z.object({
  type: z.literal("browser.cdp.tab.close.response"),
  payload: z.object({ requestId: z.string(), error: z.string().nullable() }),
});

/** An owned subscription. The response is the tab list; browser.cdp.tabs.update follows. */
export const BrowserCdpTabsSubscribeRequestSchema = z.object({
  type: z.literal("browser.cdp.tabs.subscribe.request"),
  requestId: z.string(),
  workspaceId: z.string().optional(),
});
export const BrowserCdpTabsSubscribeResponseSchema = z.object({
  type: z.literal("browser.cdp.tabs.subscribe.response"),
  payload: z.object({
    requestId: z.string(),
    subscriptionId: z.string(),
    connected: z.boolean(),
    tabs: z.array(CdpBrowserTabStateSchema),
    error: z.string().nullable(),
  }),
});
export const BrowserCdpTabsUpdateSchema = z.object({
  type: z.literal("browser.cdp.tabs.update"),
  payload: z.object({ subscriptionId: z.string(), event: CdpBrowserTabsEventSchema }),
});

/**
 * An owned subscription. Frames arrive as binary frames with opcode 0x50: JPEG at quality 60,
 * at most 10 per second, at most 1920x1080.
 */
export const BrowserCdpViewSubscribeRequestSchema = z.object({
  type: z.literal("browser.cdp.view.subscribe.request"),
  requestId: z.string(),
  browserId: z.string(),
  width: z.number(),
  height: z.number(),
  deviceScaleFactor: z.number(),
});
export const BrowserCdpViewSubscribeResponseSchema = z.object({
  type: z.literal("browser.cdp.view.subscribe.response"),
  payload: z.object({
    requestId: z.string(),
    subscriptionId: z.string(),
    error: z.string().nullable(),
  }),
});
/** The view stopped or stalled: the tab closed, the host went away, or a command timed out. */
export const BrowserCdpViewUpdateSchema = z.object({
  type: z.literal("browser.cdp.view.update"),
  payload: z.object({ subscriptionId: z.string(), error: z.string() }),
});

// Input is a stream, so it has no response. diff.unsubscribe.request is the precedent.
export const BrowserCdpViewInputRequestSchema = z.object({
  type: z.literal("browser.cdp.view.input.request"),
  subscriptionId: z.string(),
  input: CdpBrowserViewInputSchema,
  /**
   * The sender's pane size. Real input claims the tab's viewport for this client; a `resize` does too,
   * except while an agent's `browser_resize` holds the size.
   */
  viewport: CdpBrowserViewportSchema.optional(),
});

export const BrowserCdpViewNavigateRequestSchema = z.object({
  type: z.literal("browser.cdp.view.navigate.request"),
  requestId: z.string(),
  browserId: z.string(),
  action: CdpBrowserNavigateActionSchema,
});
export const BrowserCdpViewNavigateResponseSchema = z.object({
  type: z.literal("browser.cdp.view.navigate.response"),
  payload: z.object({ requestId: z.string(), error: z.string().nullable() }),
});

/**
 * An element a person picked in a tab, as the page describes it. The daemon cuts every string and
 * list to a bound before it sends one: the values come from the page, which is not trusted. The
 * app builds the composer's browser element attachment from it.
 */
export const CdpBrowserElementSelectionSchema = z.object({
  url: z.string(),
  selector: z.string(),
  tag: z.string(),
  text: z.string(),
  outerHTML: z.string(),
  computedStyles: z.record(z.string(), z.string()),
  /** Page CSS pixels, relative to the viewport at the moment of the pick. */
  boundingRect: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }),
  /** Set when the page is a React development build that names the element's source. */
  reactSource: z
    .object({
      fileName: z.string().nullable(),
      lineNumber: z.number().nullable(),
      columnNumber: z.number().nullable(),
      componentName: z.string().nullable(),
    })
    .nullable(),
  parentChain: z.array(z.string()),
  children: z.array(z.string()),
});

/**
 * Gate: server_info.features.cdpBrowserPick. Turns the tab into a picker: the page outlines the
 * element under the pointer and takes the next click as the pick, so the click reaches nothing on
 * the page. The response comes when an element is picked, when the pick ends without one
 * (`selection` and `error` both null: Escape in the page, cancel_pick, a navigation, or another
 * pick on the tab), or with an error: browser_page_loading, or browser_timeout after 30 s.
 */
export const BrowserCdpViewPickElementRequestSchema = z.object({
  type: z.literal("browser.cdp.view.pick_element.request"),
  requestId: z.string(),
  browserId: z.string(),
});
export const BrowserCdpViewPickElementResponseSchema = z.object({
  type: z.literal("browser.cdp.view.pick_element.response"),
  payload: z.object({
    requestId: z.string(),
    selection: CdpBrowserElementSelectionSchema.nullable(),
    error: z.string().nullable(),
  }),
});

// Ends the sender's pick on the tab. It has no response of its own: the pick_element it ends
// answers, with no selection and no error.
export const BrowserCdpViewCancelPickRequestSchema = z.object({
  type: z.literal("browser.cdp.view.cancel_pick.request"),
  browserId: z.string(),
});

/**
 * Gate: server_info.features.cdpBrowserProfiles. A named profile of the Docker Chromium: tabs
 * opened in it share cookies with each other and with no other profile. The daemon keeps a
 * profile's cookies across a Chromium restart; other site storage lasts until then.
 */
export const CdpBrowserProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Daemon wall-clock time, epoch ms. */
  createdAt: z.number(),
});

/** What an import did. It names sites and never a cookie's value. */
export const CdpBrowserCookieImportResultSchema = z.object({
  /** Cookies the Chromium kept. */
  imported: z.number().int(),
  /** Entries that were unusable, had expired, or that the Chromium refused. */
  skipped: z.number().int(),
  /** The first sites the kept cookies belong to, in name order; `siteCount` is how many there are. */
  sites: z.array(z.string()),
  siteCount: z.number().int(),
});

/**
 * Where an import's cookies come from. `text` is a cookie file's content: a JSON export (an array,
 * or an object with a `cookies` array) or a Netscape cookies.txt. `shared` copies the Shared
 * profile's cookies for the sites named and the hosts under them.
 */
export const CdpBrowserCookieSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string() }),
  z.object({ kind: z.literal("shared"), sites: z.array(z.string()) }),
]);

/** The profiles, and the one the workspace's new tabs open in; null is Shared. */
export const BrowserCdpProfileListRequestSchema = z.object({
  type: z.literal("browser.cdp.profile.list.request"),
  requestId: z.string(),
  workspaceId: z.string().optional(),
});
export const BrowserCdpProfileListResponseSchema = z.object({
  type: z.literal("browser.cdp.profile.list.response"),
  payload: z.object({
    requestId: z.string(),
    profiles: z.array(CdpBrowserProfileSchema),
    workspaceProfileId: z.string().nullable(),
    error: z.string().nullable(),
  }),
});

export const BrowserCdpProfileCreateRequestSchema = z.object({
  type: z.literal("browser.cdp.profile.create.request"),
  requestId: z.string(),
  name: z.string(),
});
export const BrowserCdpProfileCreateResponseSchema = z.object({
  type: z.literal("browser.cdp.profile.create.response"),
  payload: z.object({
    requestId: z.string(),
    profile: CdpBrowserProfileSchema.nullable(),
    error: z.string().nullable(),
  }),
});

/** Closes the profile's tabs and forgets its cookies. Its workspaces go back to Shared. */
export const BrowserCdpProfileDeleteRequestSchema = z.object({
  type: z.literal("browser.cdp.profile.delete.request"),
  requestId: z.string(),
  profileId: z.string(),
});
export const BrowserCdpProfileDeleteResponseSchema = z.object({
  type: z.literal("browser.cdp.profile.delete.response"),
  payload: z.object({ requestId: z.string(), error: z.string().nullable() }),
});

/**
 * The profile the workspace's new tabs open in, whoever opens them: a person or an agent's
 * browser_new_tab. Null is Shared. A tab that is open keeps the profile it opened in.
 */
export const BrowserCdpProfileAssignRequestSchema = z.object({
  type: z.literal("browser.cdp.profile.assign.request"),
  requestId: z.string(),
  workspaceId: z.string(),
  profileId: z.string().nullable(),
});
export const BrowserCdpProfileAssignResponseSchema = z.object({
  type: z.literal("browser.cdp.profile.assign.response"),
  payload: z.object({ requestId: z.string(), error: z.string().nullable() }),
});

/** Adds cookies to a named profile. The cookies it already has stay, unless one is replaced. */
export const BrowserCdpProfileImportRequestSchema = z.object({
  type: z.literal("browser.cdp.profile.import.request"),
  requestId: z.string(),
  profileId: z.string(),
  source: CdpBrowserCookieSourceSchema,
});
export const BrowserCdpProfileImportResponseSchema = z.object({
  type: z.literal("browser.cdp.profile.import.response"),
  payload: z.object({
    requestId: z.string(),
    result: CdpBrowserCookieImportResultSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export type CdpBrowserTabState = z.infer<typeof CdpBrowserTabStateSchema>;
export type CdpBrowserProfile = z.infer<typeof CdpBrowserProfileSchema>;
export type CdpBrowserCookieSource = z.infer<typeof CdpBrowserCookieSourceSchema>;
export type CdpBrowserCookieImportResult = z.infer<typeof CdpBrowserCookieImportResultSchema>;
export type CdpBrowserElementSelection = z.infer<typeof CdpBrowserElementSelectionSchema>;
export type CdpBrowserTabsEvent = z.infer<typeof CdpBrowserTabsEventSchema>;
export type CdpBrowserViewport = z.infer<typeof CdpBrowserViewportSchema>;
export type CdpBrowserViewInput = z.infer<typeof CdpBrowserViewInputSchema>;
export type CdpBrowserNavigateAction = z.infer<typeof CdpBrowserNavigateActionSchema>;
