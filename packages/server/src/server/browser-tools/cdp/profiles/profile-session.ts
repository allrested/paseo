import type { Logger } from "pino";
import type {
  CdpBrowserCookieImportResult,
  CdpBrowserErrorCode,
  CdpBrowserProfile,
} from "@getpaseo/protocol/browser-automation/cdp-view-schemas";
import type { SessionInboundMessage, SessionOutboundMessage } from "@getpaseo/protocol/messages";
import { cdpErrorCode, type CdpBrowserService } from "../cdp-browser-service.js";
import { CookieFileError } from "./cookie-file.js";
import { CdpProfileError, type CdpProfile } from "./profile-store.js";
import type { CdpProfiles } from "./profiles.js";

type Inbound<T extends SessionInboundMessage["type"]> = Extract<SessionInboundMessage, { type: T }>;
type Emit = (message: SessionOutboundMessage) => void;

/** The one map from a profile failure to the code a client gets. */
export function profileErrorCode(error: unknown): CdpBrowserErrorCode {
  if (error instanceof CdpProfileError || error instanceof CookieFileError) return error.code;
  return cdpErrorCode(error);
}

/** A profile as clients see it: without the Chromium context it lives in. */
function toWire(profile: CdpProfile): CdpBrowserProfile {
  return { id: profile.id, name: profile.name, createdAt: profile.createdAt };
}

/**
 * The browser.cdp.profile.* handlers. They hold no state of their own: the profiles belong to the
 * daemon and are the same for every session.
 */
export class CdpProfileSession {
  constructor(
    private readonly service: () => CdpBrowserService | null,
    private readonly logger: Pick<Logger, "debug">,
  ) {}

  async list(msg: Inbound<"browser.cdp.profile.list.request">, emit: Emit): Promise<void> {
    const respond = (
      profiles: CdpBrowserProfile[],
      workspaceProfileId: string | null,
      error: CdpBrowserErrorCode | null,
    ) =>
      emit({
        type: "browser.cdp.profile.list.response",
        payload: { requestId: msg.requestId, profiles, workspaceProfileId, error },
      });
    await this.run(
      "list",
      (error) => respond([], null, error),
      async (profiles) => {
        const chosen = msg.workspaceId === undefined ? null : profiles.profileOf(msg.workspaceId);
        respond(profiles.list().map(toWire), chosen?.id ?? null, null);
      },
    );
  }

  async create(msg: Inbound<"browser.cdp.profile.create.request">, emit: Emit): Promise<void> {
    const respond = (profile: CdpBrowserProfile | null, error: CdpBrowserErrorCode | null) =>
      emit({
        type: "browser.cdp.profile.create.response",
        payload: { requestId: msg.requestId, profile, error },
      });
    await this.run(
      "create",
      (error) => respond(null, error),
      async (profiles) => {
        respond(toWire(profiles.create(msg.name)), null);
      },
    );
  }

  async delete(msg: Inbound<"browser.cdp.profile.delete.request">, emit: Emit): Promise<void> {
    const respond = (error: CdpBrowserErrorCode | null) =>
      emit({
        type: "browser.cdp.profile.delete.response",
        payload: { requestId: msg.requestId, error },
      });
    await this.run("delete", respond, async (profiles) => {
      await profiles.delete(msg.profileId);
      respond(null);
    });
  }

  async assign(msg: Inbound<"browser.cdp.profile.assign.request">, emit: Emit): Promise<void> {
    const respond = (error: CdpBrowserErrorCode | null) =>
      emit({
        type: "browser.cdp.profile.assign.response",
        payload: { requestId: msg.requestId, error },
      });
    await this.run("assign", respond, async (profiles) => {
      profiles.assign(msg.workspaceId, msg.profileId);
      respond(null);
    });
  }

  async importCookies(
    msg: Inbound<"browser.cdp.profile.import.request">,
    emit: Emit,
  ): Promise<void> {
    const respond = (
      result: CdpBrowserCookieImportResult | null,
      error: CdpBrowserErrorCode | null,
    ) =>
      emit({
        type: "browser.cdp.profile.import.response",
        payload: { requestId: msg.requestId, result, error },
      });
    await this.run(
      "import",
      (error) => respond(null, error),
      async (profiles) => {
        const { source } = msg;
        const result =
          source.kind === "text"
            ? await profiles.importText(msg.profileId, source.text)
            : await profiles.importShared(msg.profileId, source.sites);
        respond(result, null);
      },
    );
  }

  /** Runs one handler against the loaded profiles; any failure answers with its code. */
  private async run(
    operation: string,
    fail: (error: CdpBrowserErrorCode) => void,
    handle: (profiles: CdpProfiles) => Promise<void>,
  ): Promise<void> {
    const profiles = this.service()?.profiles;
    if (!profiles) return fail("browser_unsupported");
    try {
      // The service loads them when Chromium first answers, which may not have happened yet.
      await profiles.load();
      await handle(profiles);
    } catch (error) {
      // These errors name a code or a CDP method; none of them carries a cookie.
      this.logger.debug({ err: error }, `browser.cdp.profile.${operation} failed`);
      fail(profileErrorCode(error));
    }
  }
}
