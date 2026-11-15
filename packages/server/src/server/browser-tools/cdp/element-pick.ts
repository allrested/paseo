// The daemon side of browser.cdp.view.pick_element: it makes the page a picker, asks the page how
// the pick stands until it ends, and turns the page's answer into a bounded selection.
import { setTimeout as delay } from "node:timers/promises";
import type {
  CdpBrowserElementSelection,
  CdpBrowserErrorCode,
} from "@getpaseo/protocol/browser-automation/cdp-view-schemas";
import { cdpErrorCode } from "./cdp-browser-service.js";
import {
  elementPickClearScript,
  elementPickInstallScript,
  elementPickPollScript,
} from "./element-pick-script.js";

/** A pick nobody finishes ends by itself, so a page is never left a picker. */
export const PICK_TIMEOUT_MS = 30_000;
/** How often the page is asked. A pick is a person's click, so this is the delay they may see. */
export const PICK_POLL_MS = 200;

/** The part of a tab a pick uses; CdpTab satisfies it. */
export interface PickTab {
  isLoading(): boolean;
  isDestroyed(): boolean;
  executeJavaScript(code: string): Promise<unknown>;
}

export type PickOutcome =
  | { kind: "picked"; selection: CdpBrowserElementSelection }
  /** Ended without an element: Escape, a cancel, a navigation, or another pick on the page. */
  | { kind: "cancelled" }
  | { kind: "failed"; error: CdpBrowserErrorCode };

export interface PickOptions {
  tab: PickTab;
  /** Tells this pick's picker and result from another pick's on the same page. */
  token: string;
  /** Aborting ends the pick as cancelled. */
  signal: AbortSignal;
  timeoutMs?: number;
  pollMs?: number;
  now?: () => number;
}

const failed = (error: CdpBrowserErrorCode): PickOutcome => ({ kind: "failed", error });
const CANCELLED: PickOutcome = { kind: "cancelled" };

// Bounds on what a page may put into a selection. The page's own script already cuts the text and
// the HTML to these lengths; a page that answers in the script's place is cut here.
const MAX = {
  url: 2048,
  selector: 1024,
  tag: 64,
  text: 500,
  outerHTML: 2000,
  styles: 24,
  styleName: 64,
  styleValue: 256,
  line: 256,
  parents: 8,
  children: 12,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number): string =>
  typeof value === "string" ? value.slice(0, max) : "";
const textOrNull = (value: unknown, max: number): string | null =>
  typeof value === "string" ? value.slice(0, max) : null;
const numberOr = <T>(value: unknown, otherwise: T): number | T =>
  typeof value === "number" && Number.isFinite(value) ? value : otherwise;
const lines = (value: unknown, max: number): string[] =>
  Array.isArray(value)
    ? value
        .filter((line): line is string => typeof line === "string")
        .slice(0, max)
        .map((line) => line.slice(0, MAX.line))
    : [];

function styles(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const kept = Object.entries(value)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .slice(0, MAX.styles)
    .map(([name, style]) => [name.slice(0, MAX.styleName), style.slice(0, MAX.styleValue)]);
  return Object.fromEntries(kept);
}

/** The selection a page reported, cut to its bounds; null for an answer that names no element. */
export function readSelection(value: unknown): CdpBrowserElementSelection | null {
  if (!isRecord(value)) return null;
  const tag = text(value.tag, MAX.tag);
  if (tag === "") return null;
  const rect = isRecord(value.boundingRect) ? value.boundingRect : {};
  const source = value.reactSource;
  return {
    url: text(value.url, MAX.url),
    selector: text(value.selector, MAX.selector),
    tag,
    text: text(value.text, MAX.text),
    outerHTML: text(value.outerHTML, MAX.outerHTML),
    computedStyles: styles(value.computedStyles),
    boundingRect: {
      x: numberOr(rect.x, 0),
      y: numberOr(rect.y, 0),
      width: numberOr(rect.width, 0),
      height: numberOr(rect.height, 0),
    },
    reactSource: isRecord(source)
      ? {
          fileName: textOrNull(source.fileName, MAX.selector),
          lineNumber: numberOr(source.lineNumber, null),
          columnNumber: numberOr(source.columnNumber, null),
          componentName: textOrNull(source.componentName, MAX.line),
        }
      : null,
    parentChain: lines(value.parentChain, MAX.parents),
    children: lines(value.children, MAX.children),
  };
}

/** What the page's answer to a poll means; null while it still waits for a click. */
function readPoll(raw: unknown): PickOutcome | null {
  if (typeof raw !== "string") return null;
  let answer: unknown;
  try {
    answer = JSON.parse(raw);
  } catch {
    return failed("browser_unknown_error");
  }
  if (isRecord(answer) && answer.__cancelled === true) return CANCELLED;
  const selection = readSelection(answer);
  return selection ? { kind: "picked", selection } : failed("browser_unknown_error");
}

async function install(tab: PickTab, token: string): Promise<PickOutcome | null> {
  let answer: unknown;
  try {
    answer = await tab.executeJavaScript(elementPickInstallScript(token));
  } catch (error) {
    return failed(cdpErrorCode(error));
  }
  if (!isRecord(answer) || answer.sessionToken !== token) return failed("browser_unknown_error");
  if (answer.installed === true) return null;
  return failed(
    answer.reason === "document-loading" ? "browser_page_loading" : "browser_unknown_error",
  );
}

/**
 * Lets a person pick one element on the tab's page. Resolves when the pick ends, however it ends,
 * and leaves no picker on the page. Never rejects.
 */
export async function pickElement(options: PickOptions): Promise<PickOutcome> {
  const { tab, token, signal } = options;
  const now = options.now ?? Date.now;
  if (signal.aborted) return CANCELLED;
  if (tab.isLoading()) return failed("browser_page_loading");
  const refused = await install(tab, token);
  if (refused) return refused;

  const deadline = now() + (options.timeoutMs ?? PICK_TIMEOUT_MS);
  // The page ends its own picker on a click or Escape; every other end leaves it to be removed.
  const end = (outcome: PickOutcome): PickOutcome => {
    tab.executeJavaScript(elementPickClearScript(token)).catch(() => undefined);
    return outcome;
  };
  for (;;) {
    if (signal.aborted) return end(CANCELLED);
    if (tab.isDestroyed()) return failed("browser_tab_not_found");
    if (now() >= deadline) return end(failed("browser_timeout"));
    let raw: unknown = null;
    try {
      raw = await tab.executeJavaScript(elementPickPollScript(token));
    } catch {
      // The page is between two documents, or does not answer. The next poll finds the picker
      // gone, the tab closed, or the time up.
    }
    const outcome = readPoll(raw);
    if (outcome) return outcome.kind === "failed" ? end(outcome) : outcome;
    // An abort ends the wait at once; the loop's first check then ends the pick.
    await delay(options.pollMs ?? PICK_POLL_MS, undefined, { signal }).catch(() => undefined);
  }
}
