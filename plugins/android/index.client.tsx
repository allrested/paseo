import { useCallback, useEffect, useState } from "react";
import {
  useRpc,
  type PluginClientContext,
  type PluginSidebarItemProps,
} from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { androidStateRpc } from "./shared/contracts.js";
import { AndroidSurface } from "./client/android-surface.js";

const SCREEN_ID = "android";
const PANEL_ID = "android";
const ICON = "Smartphone";

function AndroidItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  const open = useCallback(() => openScreen({ screenId: SCREEN_ID }), [openScreen]);
  const askState = useRpc(androidStateRpc);
  // Nothing while the host has not answered, when it has no device, and when the call fails.
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let active = true;
    askState({}).then(
      (state) => active && setAvailable(state.available),
      () => active && setAvailable(false),
    );
    return () => {
      active = false;
    };
  }, [askState]);
  if (!available) return null;
  return <SidebarRow icon={ICON} active={currentScreen?.screenId === SCREEN_ID} onPress={open} />;
}

// A plugin cannot know the host's state before it mounts, so the screen and the panel are always
// registered and say "No Android device on this host" when there is none; a tab or a route may
// already point at them. The sidebar row hides itself, and the Command Center item is added at
// runtime only once the host says it has a device. A built-in has no row in Settings > Plugins:
// those two are the ways in.
export default function contribute(client: PluginClientContext) {
  const removers = [
    client.addScreen({ id: SCREEN_ID, title: "Android", Component: AndroidSurface }),
    client.addSidebarHeaderItem({ id: SCREEN_ID, title: "Android", Component: AndroidItem }),
    client.addWorkspacePanel({
      id: PANEL_ID,
      title: "Android",
      icon: ICON,
      Component: AndroidSurface,
    }),
  ];
  let stopped = false;
  void (async () => {
    try {
      const state = await client.rpc(androidStateRpc, {});
      if (stopped || !state.available) return;
      removers.push(
        client.addCommandCenterItem({
          id: "open-android",
          title: "Open Android device",
          icon: ICON,
          context: "workspace",
          onSelect({ openPanel }) {
            openPanel(PANEL_ID);
          },
        }),
      );
    } catch {
      // A host that does not serve the call, or cannot be reached, has no item to offer.
    }
  })();
  return () => {
    stopped = true;
    for (const remove of removers) void remove();
  };
}
