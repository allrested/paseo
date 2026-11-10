import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { getIsElectron } from "@/constants/platform";
import { useToast } from "@/contexts/toast-context";
import { useHostFeature } from "@/runtime/host-features";
import { openCdpTab, useCdpTabsSync } from "./tabs-sync";
import { cdpOpenErrorKey } from "./workspace-browser";

export interface OpenCdpBrowserTabInput {
  url?: string;
  replaceTabId?: string;
  paneId?: string;
}

/**
 * The workspace's link to the host's Docker Chromium. `enabled` is the host's `cdpBrowser` feature,
 * off in Electron, which keeps its own webview tabs. Tab sync runs for as long as the workspace is
 * open, so tabs an agent opens appear and the "no Chromium host" state shows without a visible pane.
 */
export function useWorkspaceCdpBrowser(input: {
  client: DaemonClient | null;
  serverId: string;
  workspaceId: string;
}) {
  const { client, serverId, workspaceId } = input;
  const { t } = useTranslation();
  const toast = useToast();
  const hostHasCdpBrowser = useHostFeature(serverId, "cdpBrowser");
  const enabled = hostHasCdpBrowser && !getIsElectron();
  useCdpTabsSync({ client, serverId, workspaceId, enabled });

  const open = useCallback(
    (tab: OpenCdpBrowserTabInput = {}) => {
      if (!client || !serverId || !workspaceId) return;
      openCdpTab({ client, serverId, workspaceId, ...tab }).catch((error: unknown) => {
        toast.error(t(cdpOpenErrorKey(error)));
      });
    },
    [client, serverId, workspaceId, t, toast],
  );

  // A tab the daemon already lost answers browser_tab_not_found, which needs no handling.
  const close = useCallback(
    (browserId: string) => {
      if (!enabled) return;
      client?.closeCdpBrowserTab(browserId).catch(() => {});
    },
    [client, enabled],
  );

  // Electron has its own tabs, so it shows the create entry too.
  const canCreateTab = enabled || getIsElectron();
  return useMemo(
    () => ({ enabled, canCreateTab, open, close }),
    [enabled, canCreateTab, open, close],
  );
}
