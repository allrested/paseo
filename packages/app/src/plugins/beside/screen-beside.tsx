import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginScreenParams, PluginScreenProps } from "@getpaseo/plugin/client";
import { router } from "expo-router";
import { useCallback, useMemo, type ComponentType } from "react";
import { Text } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useHosts } from "@/runtime/host-runtime";
import type { Theme } from "@/styles/theme";
import type { ResolvedBesideTarget } from "../host-navigation-model";
import { usePluginHostNavigation } from "../host-navigation";
import { PluginIconView } from "../icons";
import { PluginInstallationProvider } from "../installation-provider";
import { resolvePluginPlatform } from "../platform";
import { pluginRegistry, useInstalledPlugin } from "../registry";
import { buildPluginSurfaceRoute } from "../routes";
import {
  resolvePluginScreenTitle,
  resolvePluginSurfaceContribution,
} from "../surface-contribution";
import { SurfaceErrorBoundary } from "../surface-error-boundary";
import { toPluginTheme } from "../theme";
import type { InstalledPlugin } from "../types";
import { registerBesideKind } from "./beside-area";
import { BesideHeader } from "./beside-header";

type ScreenTarget = Extract<ResolvedBesideTarget, { kind: "screen" }>;
type PluginScreen = InstalledPlugin["surfaces"][number];

// Shared by every screen shown without params, so no plugin can write into it.
const NO_PARAMS: PluginScreenParams = Object.freeze({});
// The area is narrow on every layout.
const LAYOUT: PluginScreenProps["layout"] = { compact: true, platform: resolvePluginPlatform() };
const pluginThemeMapping = (theme: Theme) => ({ theme: toPluginTheme(theme) });
const ThemedPluginIcon = withUnistyles(PluginIconView, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

function findScreen(plugin: InstalledPlugin | null, screenId: string): PluginScreen | null {
  return resolvePluginSurfaceContribution(plugin, { kind: "surface", id: screenId }).surface;
}

function ScreenBesideHeader({ target, close }: { target: ScreenTarget; close(): void }) {
  const { serverId, pluginId, screenId } = target;
  const params = target.params ?? NO_PARAMS;
  const plugin = useInstalledPlugin(serverId, pluginId);
  const title = useMemo(() => {
    const screen = findScreen(plugin, screenId);
    if (!plugin || !screen) return pluginId;
    // The title the screen's own route shows, which the action opens.
    return resolvePluginScreenTitle(screen, null, params, (text) =>
      plugin.i18n.resolve(text, plugin.locale),
    );
  }, [params, plugin, pluginId, screenId]);
  // Only a legacy sidebar item carries an icon; a header or footer item draws its own row.
  const icon = plugin?.legacySidebarItems.find((item) => item.surface === screenId)?.icon;
  const iconView = useMemo(
    () => (icon ? <ThemedPluginIcon icon={icon} size={16} /> : null),
    [icon],
  );
  const openScreen = useCallback(() => {
    router.push(
      buildPluginSurfaceRoute(serverId, pluginId, { kind: "surface", id: screenId }, params),
    );
    close();
  }, [close, params, pluginId, screenId, serverId]);
  const action = useMemo(
    () => ({ label: `Open ${title}`, onPress: openScreen }),
    [openScreen, title],
  );
  return <BesideHeader icon={iconView} title={title} action={action} onClose={close} />;
}

/**
 * The named plugin's screen inside that plugin's own installation and error boundary, so its
 * failure is its own and stays in the area.
 */
function ScreenBesideBody({ target }: { target: ScreenTarget }) {
  const plugin = useInstalledPlugin(target.serverId, target.pluginId);
  const screen = findScreen(plugin, target.screenId);
  if (!plugin || !screen) {
    return <Text style={styles.unavailable}>This plugin surface is unavailable.</Text>;
  }
  return (
    <SurfaceErrorBoundary installation={plugin} Surface={screen.Component}>
      <ThemedScreenRenderer
        Screen={screen.Component}
        plugin={plugin}
        target={target}
        uniProps={pluginThemeMapping}
      />
    </SurfaceErrorBoundary>
  );
}

function ScreenRenderer({
  Screen,
  plugin,
  target,
  theme,
}: {
  Screen: ComponentType<PluginScreenProps>;
  plugin: InstalledPlugin;
  target: ScreenTarget;
  theme: PluginTheme;
}) {
  const hosts = useHosts();
  const hostLabel = hosts.find((host) => host.serverId === target.serverId)?.label;
  const host = useMemo(
    () => ({ id: target.serverId, label: hostLabel ?? target.serverId }),
    [hostLabel, target.serverId],
  );
  // What the area shows gets no side area of its own.
  const navigation = usePluginHostNavigation(target.serverId);
  return (
    <PluginInstallationProvider plugin={plugin}>
      <Screen
        theme={theme}
        host={host}
        layout={LAYOUT}
        navigation={navigation}
        params={target.params ?? NO_PARAMS}
      />
    </PluginInstallationProvider>
  );
}

const ThemedScreenRenderer = withUnistyles(ScreenRenderer);

registerBesideKind("screen", {
  available: ({ serverId, pluginId, screenId }) => {
    const plugin = pluginRegistry
      .getSnapshot()
      .find((candidate) => candidate.serverId === serverId && candidate.id === pluginId);
    return findScreen(plugin ?? null, screenId) !== null;
  },
  Header: ScreenBesideHeader,
  Body: ScreenBesideBody,
});

const styles = StyleSheet.create((theme) => ({
  // The look of the screen route's unavailable placeholder (surface-screen.tsx).
  unavailable: {
    color: theme.colors.statusDanger,
    padding: theme.spacing[4],
  },
}));
