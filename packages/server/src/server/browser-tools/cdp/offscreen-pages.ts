// Fork delta (office stream): pages in the daemon's Chromium that belong to no workspace. They are
// in no tab registry, so no pane shows them, no `browser_*` tool reaches them and `list_tabs` does
// not list them. Built-in plugins get this service from the daemon (`BuiltinPluginInfo`).
import type { Logger } from "pino";
import type { CdpConnection } from "./cdp-connection.js";
import type { CdpEndpoint } from "./cdp-endpoint.js";

export interface OffscreenViewport {
  /** CSS pixels. */
  width: number;
  height: number;
  deviceScaleFactor: number;
}

export interface OffscreenPage {
  /** Runtime.evaluate with returnByValue and awaitPromise. Rejects with the page's exception text. */
  evaluate<T = unknown>(expression: string): Promise<T>;
  /** One raw CDP command on the page, such as Input.dispatchMouseEvent. */
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  setViewport(viewport: OffscreenViewport): Promise<void>;
  /** Closes the target. Safe to call twice. */
  close(): Promise<void>;
  /** Runs once when the page is gone, whoever closed it. Returns the remover. */
  onClosed(listener: () => void): () => void;
}

export interface OffscreenPages {
  open(viewport: OffscreenViewport): Promise<OffscreenPage>;
}

export interface CdpOffscreenPagesOptions {
  endpoint: CdpEndpoint;
  logger: Pick<Logger, "debug" | "warn">;
}

interface EvaluateResult {
  result?: { value?: unknown };
  exceptionDetails?: { text?: string; exception?: { description?: string } };
}

function metrics(viewport: OffscreenViewport): Record<string, unknown> {
  return {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.deviceScaleFactor,
    mobile: false,
  };
}

export class CdpOffscreenPages implements OffscreenPages {
  private readonly pages = new Set<OffscreenPage>();

  constructor(private readonly options: CdpOffscreenPagesOptions) {}

  async open(viewport: OffscreenViewport): Promise<OffscreenPage> {
    // A background tab is hidden and its requestAnimationFrame never fires; a background window is
    // visible and does not take focus from the noVNC desktop (as CdpBrowserService.openTab).
    const targetId = await this.withBrowser(async (browser) => {
      const created = await browser.send<{ targetId: string }>("Target.createTarget", {
        url: "about:blank",
        newWindow: true,
        background: true,
      });
      return created.targetId;
    });
    let connection: CdpConnection;
    try {
      connection = await this.options.endpoint.connectTarget(targetId);
      await connection.send("Emulation.setDeviceMetricsOverride", metrics(viewport));
    } catch (error) {
      await this.closeTarget(targetId);
      throw error;
    }
    const page = this.pageOf(targetId, connection);
    this.pages.add(page);
    page.onClosed(() => this.pages.delete(page));
    return page;
  }

  /** Closes every open page. */
  async stop(): Promise<void> {
    await Promise.all([...this.pages].map((page) => page.close()));
  }

  private pageOf(targetId: string, connection: CdpConnection): OffscreenPage {
    const listeners = new Set<() => void>();
    let gone = false;
    const markGone = () => {
      if (gone) return;
      gone = true;
      for (const listener of listeners) {
        try {
          listener();
        } catch (error) {
          this.options.logger.warn({ err: error }, "Offscreen page close listener failed");
        }
      }
      listeners.clear();
    };
    connection.onClose(markGone);
    return {
      evaluate: async <T>(expression: string): Promise<T> => {
        const answer = await connection.send<EvaluateResult>("Runtime.evaluate", {
          expression,
          returnByValue: true,
          awaitPromise: true,
        });
        if (answer.exceptionDetails) {
          const { exception, text } = answer.exceptionDetails;
          throw new Error(exception?.description ?? text ?? "The page threw an exception");
        }
        return answer.result?.value as T;
      },
      send: (method, params) => connection.send(method, params),
      setViewport: async (next) => {
        await connection.send("Emulation.setDeviceMetricsOverride", metrics(next));
      },
      close: async () => {
        if (gone) return;
        markGone();
        connection.close();
        await this.closeTarget(targetId);
      },
      onClosed: (listener) => {
        if (gone) return () => {};
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
  }

  /** Never rejects: a target that cannot be closed is logged, and Chromium keeps a stray window. */
  private async closeTarget(targetId: string): Promise<void> {
    try {
      await this.withBrowser((browser) => browser.send("Target.closeTarget", { targetId }));
    } catch (error) {
      this.options.logger.debug({ err: error, targetId }, "Failed to close an offscreen page");
    }
  }

  private async withBrowser<T>(run: (browser: CdpConnection) => Promise<T>): Promise<T> {
    const browser = await this.options.endpoint.connectBrowser();
    try {
      return await run(browser);
    } finally {
      browser.close();
    }
  }
}
