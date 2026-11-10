import path from "node:path";
import type { Logger } from "pino";
import type { BrowserToolsBroker } from "../broker.js";
import { CDP_COMMAND_TIMEOUT_MS, CdpBrowserService } from "./cdp-browser-service.js";
import { CdpEndpoint } from "./cdp-endpoint.js";
import { CdpTabRegistry } from "./tab-registry.js";

export function createCdpBrowserService(input: {
  url: string;
  paseoHome: string;
  broker: BrowserToolsBroker;
  logger: Logger;
}): CdpBrowserService {
  const logger = input.logger.child({ module: "cdp-browser" });
  const onError = (error: unknown) => logger.debug({ err: error }, "CDP error");
  return new CdpBrowserService({
    endpoint: new CdpEndpoint({
      url: input.url,
      commandTimeoutMs: CDP_COMMAND_TIMEOUT_MS,
      onError,
    }),
    registry: new CdpTabRegistry(
      path.join(input.paseoHome, "browser-tools", "cdp-tabs.json"),
      (error) => logger.warn({ err: error }, "Failed to read or write the CDP tab registry"),
    ),
    broker: input.broker,
    logger,
  });
}
