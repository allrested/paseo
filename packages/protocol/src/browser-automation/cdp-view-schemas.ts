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
  /** The sender's pane size. Any input claims the tab's viewport for this client. */
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

export type CdpBrowserTabState = z.infer<typeof CdpBrowserTabStateSchema>;
export type CdpBrowserTabsEvent = z.infer<typeof CdpBrowserTabsEventSchema>;
export type CdpBrowserViewport = z.infer<typeof CdpBrowserViewportSchema>;
export type CdpBrowserViewInput = z.infer<typeof CdpBrowserViewInputSchema>;
export type CdpBrowserNavigateAction = z.infer<typeof CdpBrowserNavigateActionSchema>;
