import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Logger } from "pino";
import type { BrowserToolsBroker } from "../broker.js";
import { CDP_COMMAND_TIMEOUT_MS, CdpBrowserService } from "./cdp-browser-service.js";
import { CdpEndpoint } from "./cdp-endpoint.js";
import { CdpCookieVault } from "./profiles/cookie-vault.js";
import { CdpProfileStore } from "./profiles/profile-store.js";
import { CdpProfiles } from "./profiles/profiles.js";
import { CdpTabRegistry } from "./tab-registry.js";

export function createCdpBrowserService(input: {
  url: string;
  paseoHome: string;
  broker: BrowserToolsBroker;
  logger: Logger;
}): CdpBrowserService {
  const logger = input.logger.child({ module: "cdp-browser" });
  const onError = (error: unknown) => logger.debug({ err: error }, "CDP error");
  const folder = path.join(input.paseoHome, "browser-tools");
  const profiles = new CdpProfiles({
    store: new CdpProfileStore(path.join(folder, "cdp-profiles.json"), (error) =>
      logger.warn({ err: error }, "Failed to read or write the browser profiles"),
    ),
    vault: new CdpCookieVault(path.join(folder, "cdp-profiles")),
    logger,
    createId: randomUUID,
  });
  return new CdpBrowserService({
    endpoint: new CdpEndpoint({
      url: input.url,
      commandTimeoutMs: CDP_COMMAND_TIMEOUT_MS,
      onError,
    }),
    registry: new CdpTabRegistry(path.join(folder, "cdp-tabs.json"), (error) =>
      logger.warn({ err: error }, "Failed to read or write the CDP tab registry"),
    ),
    broker: input.broker,
    logger,
    profiles,
  });
}
