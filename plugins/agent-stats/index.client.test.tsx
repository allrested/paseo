import type { PluginClientContext } from "@getpaseo/plugin/client";
import { expect, test, vi } from "vitest";
import contribute from "./index.client.js";

vi.mock("@getpaseo/plugin/client/ui", () => ({}));

test("the plugin adds a Stats screen with a sidebar item and a Command Center item", () => {
  const added: string[] = [];
  const opened: unknown[] = [];
  const record =
    (kind: string) =>
    (contribution: { id: string; title: string; onSelect?: (context: object) => void }) => {
      added.push(`${kind}:${contribution.id}:${contribution.title}`);
      contribution.onSelect?.({ openScreen: (input: unknown) => void opened.push(input) });
      return () =>
        void added.splice(added.indexOf(`${kind}:${contribution.id}:${contribution.title}`), 1);
    };
  const client = {
    addScreen: record("screen"),
    addSidebarHeaderItem: record("sidebar"),
    addCommandCenterItem: record("command"),
  } as unknown as PluginClientContext;

  const dispose = contribute(client);

  expect(added).toEqual([
    "screen:stats:Stats",
    "sidebar:stats:Stats",
    "command:open-stats:Agent stats",
  ]);
  // The Command Center item opens the screen.
  expect(opened).toEqual([{ screenId: "stats" }]);
  dispose();
  expect(added).toEqual([]);
});
