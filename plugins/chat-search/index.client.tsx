import type { PluginClientContext } from "@getpaseo/plugin/client";
import { SearchScreen } from "./client/search-screen.js";

const SCREEN_ID = "search";
const TITLE = "Search chats";

// The sidebar's Search row opens the Command Center, and this item is in it. A sidebar row of
// its own stood next to that one and the two names did not tell them apart.
export default function contribute(client: PluginClientContext) {
  const removers = [
    client.addScreen({ id: SCREEN_ID, title: TITLE, Component: SearchScreen }),
    client.addCommandCenterItem({
      id: "open-search",
      title: TITLE,
      icon: "TextSearch",
      keywords: ["find", "history", "transcript", "message"],
      context: "global",
      onSelect({ openScreen }) {
        openScreen({ screenId: SCREEN_ID });
      },
    }),
  ];
  return () => {
    for (const remove of removers) void remove();
  };
}
