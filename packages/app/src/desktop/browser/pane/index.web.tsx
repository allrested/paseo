import { useMemo } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { CdpBrowserPane } from "@/desktop/browser/cdp/cdp-pane";
import { useHostFeature } from "@/runtime/host-features";

interface BrowserPaneProps {
  browserId: string;
  serverId: string;
  workspaceId: string;
  cwd: string | null;
  isInteractive?: boolean;
  onFocusPane?: () => void;
}

export function BrowserPane(props: BrowserPaneProps) {
  // The feature is on when the host's daemon has a Docker Chromium (PASEO_BROWSER_CDP_URL).
  const hosted = useHostFeature(props.serverId, "cdpBrowser");
  if (!hosted) return <BrowserUnavailable {...props} />;
  // The key gives each tab its own pane, so a stale frame never outlives a tab change.
  return (
    <CdpBrowserPane
      key={props.browserId}
      browserId={props.browserId}
      onFocusPane={props.onFocusPane}
      serverId={props.serverId}
      workspaceId={props.workspaceId}
    />
  );
}

function BrowserUnavailable({ browserId }: BrowserPaneProps) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const titleStyle = useMemo(
    () => [styles.title, { color: theme.colors.foreground }],
    [theme.colors.foreground],
  );
  const subtitleStyle = useMemo(
    () => [styles.subtitle, { color: theme.colors.foregroundMuted }],
    [theme.colors.foregroundMuted],
  );

  return (
    <View style={styles.container}>
      <Text style={titleStyle}>{t("workspace.browser.unavailable.title")}</Text>
      <Text style={subtitleStyle}>{t("workspace.browser.unavailable.subtitle")}</Text>
      <Text style={subtitleStyle}>{t("workspace.browser.session", { browserId })}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 16,
  },
  title: {
    fontSize: theme.fontSize.base,
    fontWeight: "600",
  },
  subtitle: {
    fontSize: theme.fontSize.sm,
  },
}));
