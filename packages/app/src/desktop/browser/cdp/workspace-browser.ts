import { viewStatusForError, type CdpViewStatus } from "./view-model";

/** The i18n key for a failed open. The daemon's error code is never shown. */
export function cdpOpenErrorKey(error: unknown): string {
  const code = error instanceof Error ? error.message : String(error);
  return viewStatusForError(code) === "unreachable"
    ? "cdpBrowser.unreachable.title"
    : "cdpBrowser.openFailed";
}

/**
 * The view status a failed navigate sets: only a closed tab or a missing host. Anything else, a
 * refused address included, leaves the page as it is and gets a message instead.
 */
export function cdpNavigateErrorStatus(error: unknown): CdpViewStatus | null {
  const status = viewStatusForError(error instanceof Error ? error.message : String(error));
  return status === "closed" || status === "unreachable" ? status : null;
}

/** The toast for a failed navigate: the scheme is named only when the daemon refused the address. */
export function cdpNavigateErrorKey(error: unknown): string {
  const code = error instanceof Error ? error.message : String(error);
  return code.includes("browser_url_refused")
    ? "cdpBrowser.navigateFailed"
    : "cdpBrowser.navigateError";
}

/**
 * `web:3000` is a Docker service name and port, but parses as a URL with the scheme `web:`, which
 * the daemon refuses. The pane's URL field reads it as a host.
 */
export function withHttpForHostPort(draft: string): string {
  const trimmed = draft.trim();
  return /^[a-zA-Z\d][a-zA-Z\d.-]*:\d{1,5}(?:[/?#]|$)/.test(trimmed) ? `http://${trimmed}` : draft;
}
