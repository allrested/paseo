import type { PluginClientContext, PluginFilePanelContribution } from "@getpaseo/plugin/client";
import { expect, test, vi } from "vitest";
import contribute from "./index.client.js";

vi.mock("@getpaseo/plugin/client/ui", () => ({}));

test("the plugin offers a table, a notebook and a PDF viewer, and takes them back", () => {
  const panels: PluginFilePanelContribution[] = [];
  const client = {
    addFilePanel(panel: PluginFilePanelContribution) {
      panels.push(panel);
      return () => void panels.splice(panels.indexOf(panel), 1);
    },
  } as unknown as PluginClientContext;

  const dispose = contribute(client);

  expect(panels.map((panel) => [panel.id, panel.title, panel.files.extensions])).toEqual([
    ["table", "Table", ["csv", "tsv"]],
    ["notebook", "Notebook", ["ipynb"]],
    ["pdf", "PDF", ["pdf"]],
  ]);
  dispose();
  expect(panels).toEqual([]);
});
