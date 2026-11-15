import { useCallback, useState } from "react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useHostFeature } from "@/runtime/host-features";
import { useCdpTabsStore } from "../tabs-store";

export interface TabProfile {
  /** The client to manage profiles with; null on a host without browser profiles. */
  client: DaemonClient | null;
  /** The named profile the tab opened in; null is the Shared profile. */
  profile: { id: string; name: string } | null;
  sheetOpen: boolean;
  /** Absent on a host without browser profiles: the toolbar then shows no profile button. */
  openSheet: (() => void) | undefined;
  closeSheet(): void;
}

/** One pane's view of its tab's browser profile, and the sheet that manages profiles. */
export function useTabProfile(input: {
  client: DaemonClient | null;
  serverId: string;
  browserId: string;
}): TabProfile {
  const { serverId, browserId } = input;
  // COMPAT(cdpBrowserProfiles): added in v0.16.0, remove gate after 2027-05-15.
  const supported = useHostFeature(serverId, "cdpBrowserProfiles");
  const client = supported ? input.client : null;
  const profile = useCdpTabsStore(
    (state) => state.hosts[serverId]?.tabs[browserId]?.profile ?? null,
  );
  const [sheetOpen, setSheetOpen] = useState(false);
  const openSheet = useCallback(() => setSheetOpen(true), []);
  const closeSheet = useCallback(() => setSheetOpen(false), []);
  return { client, profile, sheetOpen, openSheet: client ? openSheet : undefined, closeSheet };
}
