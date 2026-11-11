import type { CdpBrowserViewport } from "@getpaseo/protocol/browser-automation/cdp-view-schemas";

/** A rotation or a split drag reports several sizes in a row; only the last one is claimed. */
export const VIEWPORT_CLAIM_DEBOUNCE_MS = 150;

export interface ViewportClaimState {
  /** The live view subscription, or null while the pane is hidden or still subscribing. */
  subscriptionId: string | null;
  /** The pane's measured size, or null before it is measured. */
  viewport: CdpBrowserViewport | null;
  /** The "Agent is using this tab" badge shows: the agent's size holds while it works. */
  agentActive: boolean;
}

export interface ViewportClaim {
  update(state: ViewportClaimState): void;
  /** An input carried this size to the daemon, which claims it as well. */
  noteSent(viewport: CdpBrowserViewport): void;
  dispose(): void;
}

function sameViewport(a: CdpBrowserViewport | null, b: CdpBrowserViewport | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.width === b.width && a.height === b.height && a.deviceScaleFactor === b.deviceScaleFactor
  );
}

/**
 * Claims the tab's viewport without input when the pane becomes visible or its size changes, so a
 * tap is not aimed at a frame of the old size. Only the pane's own layout drives it: a frame of the
 * claimed size changes nothing here, so a claim cannot cause another. The daemon ignores the claim while
 * an agent's `browser_resize` holds the size.
 */
export function createViewportClaim(send: (viewport: CdpBrowserViewport) => void): ViewportClaim {
  let previous: ViewportClaimState = { subscriptionId: null, viewport: null, agentActive: false };
  let claimed: CdpBrowserViewport | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  return {
    update(state) {
      const shown = state.subscriptionId !== previous.subscriptionId;
      const changed = shown || !sameViewport(state.viewport, previous.viewport);
      previous = state;
      // A new subscription may follow another client's claim, so its size is claimed again.
      if (shown) claimed = null;
      const { viewport } = state;
      if (!state.subscriptionId || !viewport || state.agentActive) {
        cancel();
        return;
      }
      // The badge clearing is no layout change: the next change or input claims.
      if (!changed) return;
      cancel();
      if (sameViewport(viewport, claimed)) return;
      timer = setTimeout(() => {
        timer = null;
        claimed = viewport;
        send(viewport);
      }, VIEWPORT_CLAIM_DEBOUNCE_MS);
    },
    noteSent(viewport) {
      claimed = viewport;
      if (sameViewport(viewport, previous.viewport)) cancel();
    },
    dispose: cancel,
  };
}
