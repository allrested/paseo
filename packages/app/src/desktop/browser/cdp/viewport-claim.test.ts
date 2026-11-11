import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CdpBrowserViewport } from "@getpaseo/protocol/browser-automation/cdp-view-schemas";
import { createViewportClaim, VIEWPORT_CLAIM_DEBOUNCE_MS } from "./viewport-claim";

const PHONE: CdpBrowserViewport = { width: 390, height: 740, deviceScaleFactor: 2 };
const ROTATED: CdpBrowserViewport = { width: 844, height: 300, deviceScaleFactor: 2 };

describe("createViewportClaim", () => {
  let claims: CdpBrowserViewport[];
  let claim: ReturnType<typeof createViewportClaim>;

  beforeEach(() => {
    vi.useFakeTimers();
    claims = [];
    claim = createViewportClaim((viewport) => claims.push(viewport));
  });
  afterEach(() => {
    claim.dispose();
    vi.useRealTimers();
  });

  const settle = () => vi.advanceTimersByTime(VIEWPORT_CLAIM_DEBOUNCE_MS);

  it("claims the size once the pane shows a live view, after the debounce", () => {
    claim.update({ subscriptionId: "s1", viewport: PHONE, agentActive: false });
    vi.advanceTimersByTime(VIEWPORT_CLAIM_DEBOUNCE_MS - 1);
    expect(claims).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(claims).toEqual([PHONE]);
  });

  it("claims only the last size of a burst of layout changes", () => {
    claim.update({ subscriptionId: "s1", viewport: PHONE, agentActive: false });
    settle();
    claim.update({
      subscriptionId: "s1",
      viewport: { ...ROTATED, width: 600 },
      agentActive: false,
    });
    vi.advanceTimersByTime(100);
    claim.update({ subscriptionId: "s1", viewport: ROTATED, agentActive: false });
    settle();
    expect(claims).toEqual([PHONE, ROTATED]);
  });

  it("does not claim the same size again", () => {
    claim.update({ subscriptionId: "s1", viewport: PHONE, agentActive: false });
    settle();
    claim.update({ subscriptionId: "s1", viewport: { ...PHONE }, agentActive: false });
    settle();
    // A size that changes and changes back within the debounce is no change.
    claim.update({ subscriptionId: "s1", viewport: ROTATED, agentActive: false });
    claim.update({ subscriptionId: "s1", viewport: PHONE, agentActive: false });
    settle();
    expect(claims).toEqual([PHONE]);
  });

  it("does not claim a size an input already carried", () => {
    claim.update({ subscriptionId: "s1", viewport: PHONE, agentActive: false });
    claim.noteSent(PHONE);
    settle();
    expect(claims).toEqual([]);
  });

  it("does not claim for a hidden or unmeasured pane", () => {
    claim.update({ subscriptionId: null, viewport: PHONE, agentActive: false });
    settle();
    claim.update({ subscriptionId: "s1", viewport: null, agentActive: false });
    settle();
    expect(claims).toEqual([]);
    // Hiding the pane cancels a claim that was waiting.
    claim.update({ subscriptionId: "s1", viewport: PHONE, agentActive: false });
    claim.update({ subscriptionId: null, viewport: PHONE, agentActive: false });
    settle();
    expect(claims).toEqual([]);
  });

  it("claims again when the pane shows a new subscription, even at the same size", () => {
    claim.update({ subscriptionId: "s1", viewport: PHONE, agentActive: false });
    settle();
    claim.update({ subscriptionId: null, viewport: PHONE, agentActive: false });
    claim.update({ subscriptionId: "s2", viewport: PHONE, agentActive: false });
    settle();
    expect(claims).toEqual([PHONE, PHONE]);
  });

  it("holds while an agent uses the tab, and claims on the next change after it stops", () => {
    claim.update({ subscriptionId: "s1", viewport: PHONE, agentActive: false });
    settle();
    // A claim that was waiting when the agent started does not go.
    claim.update({ subscriptionId: "s1", viewport: ROTATED, agentActive: false });
    claim.update({ subscriptionId: "s1", viewport: ROTATED, agentActive: true });
    settle();
    claim.update({ subscriptionId: "s1", viewport: PHONE, agentActive: true });
    settle();
    expect(claims).toEqual([PHONE]);
    // The badge clearing is not a layout change.
    claim.update({ subscriptionId: "s1", viewport: PHONE, agentActive: false });
    settle();
    expect(claims).toEqual([PHONE]);
    claim.update({ subscriptionId: "s1", viewport: ROTATED, agentActive: false });
    settle();
    expect(claims).toEqual([PHONE, ROTATED]);
  });
});
