import type { PluginClientContext } from "@getpaseo/plugin/client";
import { NotebookPanel } from "./client/notebook/notebook-panel.js";
import { PdfPanel } from "./client/pdf-panel.js";
import { TablePanel } from "./client/table/table-panel.js";

// Viewers for files the editor shows as raw text, or cannot show at all. Each is offered beside
// the editor in the tab's "Open with" menu.
export default function contribute(client: PluginClientContext) {
  const removers = [
    client.addFilePanel({
      id: "table",
      title: "Table",
      icon: "Table",
      files: { extensions: ["csv", "tsv"] },
      Component: TablePanel,
    }),
    client.addFilePanel({
      id: "notebook",
      title: "Notebook",
      icon: "NotebookText",
      files: { extensions: ["ipynb"] },
      Component: NotebookPanel,
    }),
    client.addFilePanel({
      id: "pdf",
      title: "PDF",
      icon: "FileText",
      files: { extensions: ["pdf"] },
      Component: PdfPanel,
    }),
  ];
  return () => {
    for (const remove of removers) remove();
  };
}
