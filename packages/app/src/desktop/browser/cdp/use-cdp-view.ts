import { useCallback, useEffect, useRef, useState } from "react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { decodeBrowserViewFrame } from "@getpaseo/protocol/binary-frames/index";
import type {
  CdpBrowserNavigateAction,
  CdpBrowserViewInput,
  CdpBrowserViewport,
} from "@getpaseo/protocol/browser-automation/cdp-view-schemas";
import { viewStatusForError, type CdpViewStatus } from "./view-model";

export interface CdpViewFrame {
  jpeg: Uint8Array;
  sequence: number;
  deviceWidth: number;
  deviceHeight: number;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

const liveUnlessClosed = (current: CdpViewStatus): CdpViewStatus =>
  current === "closed" ? current : "live";
const liveIfUnresponsive = (current: CdpViewStatus): CdpViewStatus =>
  current === "unresponsive" ? "live" : current;

/**
 * Watches one daemon browser tab while `active`. Hiding the pane or backgrounding the app releases
 * the subscription, which stops the screencast when nobody else watches the tab.
 * Callers pass a null `client` for a host without the `cdpBrowser` feature.
 */
export function useCdpView(input: {
  client: DaemonClient | null;
  browserId: string;
  active: boolean;
  viewport: CdpBrowserViewport | null;
  hostConnected: boolean;
}): {
  frame: CdpViewFrame | null;
  status: CdpViewStatus;
  sendInput(input: CdpBrowserViewInput): void;
  navigate(action: CdpBrowserNavigateAction): void;
  retry(): void;
} {
  const { client, browserId, active, hostConnected } = input;
  const [frame, setFrame] = useState<CdpViewFrame | null>(null);
  const [status, setStatus] = useState<CdpViewStatus>("connecting");
  const [attempt, setAttempt] = useState(0);
  const subscriptionId = useRef<string | null>(null);
  // The size at subscribe time only seeds the tab; later sizes travel with each input.
  const viewport = useRef(input.viewport);
  viewport.current = input.viewport;
  const measured = input.viewport !== null;
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    if (!client || !active || !measured || !viewport.current) return;
    let lastSequence = 0;
    setStatus("connecting");
    const observation = client.observeCdpBrowserView({ browserId, ...viewport.current });
    const unsubscribe = observation.subscribe({
      snapshot: (snapshot) => {
        // A reconnect makes a new subscription on the daemon, whose frames count from 1 again.
        lastSequence = 0;
        subscriptionId.current = snapshot.subscriptionId;
        setStatus("live");
      },
      update: (message) => {
        if (message.type === "browser.cdp.view.update" && message.payload.error)
          setStatus(viewStatusForError(message.payload.error));
      },
      binary: (bytes) => {
        const decoded = decodeBrowserViewFrame(bytes);
        if (!decoded || decoded.sequence < lastSequence) return;
        lastSequence = decoded.sequence;
        // The payload is a view into the socket's buffer; copy what outlives this callback.
        setFrame({
          jpeg: decoded.jpeg.slice(),
          sequence: decoded.sequence,
          deviceWidth: decoded.deviceWidth,
          deviceHeight: decoded.deviceHeight,
        });
        // A frame proves the host and the page are back.
        setStatus(liveUnlessClosed);
      },
      error: (error) => setStatus(viewStatusForError(errorText(error))),
    });
    return () => {
      subscriptionId.current = null;
      unsubscribe();
      void observation.release().catch(() => {});
    };
  }, [client, browserId, active, measured, attempt]);

  // The host going away shows the unreachable state. It coming back re-subscribes only when the
  // view is stuck there: the first false -> true after mount is the tabs snapshot landing, and
  // must not churn a subscription that is still starting or already live.
  const hostWasConnected = useRef(hostConnected);
  useEffect(() => {
    const was = hostWasConnected.current;
    hostWasConnected.current = hostConnected;
    if (was && !hostConnected) setStatus("unreachable");
    if (!was && hostConnected && statusRef.current === "unreachable") setAttempt((n) => n + 1);
  }, [hostConnected]);

  const sendInput = useCallback(
    (event: CdpBrowserViewInput) => {
      const id = subscriptionId.current;
      if (!client || !id) return;
      try {
        client.sendCdpBrowserViewInput(id, event, viewport.current ?? undefined);
      } catch {
        // The socket dropped between frames; the subscription's reconnect restores input.
      }
    },
    [client],
  );

  const navigate = useCallback(
    (action: CdpBrowserNavigateAction) => {
      if (!client) return;
      client.navigateCdpBrowserView(browserId, action).then(
        () => setStatus(liveIfUnresponsive),
        (error) => setStatus(viewStatusForError(errorText(error))),
      );
    },
    [client, browserId],
  );

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  return { frame, status, sendInput, navigate, retry };
}
