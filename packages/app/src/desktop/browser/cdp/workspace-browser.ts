import { viewStatusForError } from "./view-model";

/** The i18n key for a failed open. The daemon's error code is never shown. */
export function cdpOpenErrorKey(error: unknown): string {
  const code = error instanceof Error ? error.message : String(error);
  return viewStatusForError(code) === "unreachable"
    ? "cdpBrowser.unreachable.title"
    : "cdpBrowser.openFailed";
}
