/**
 * @vitest-environment jsdom
 */
// The PDF panel, mounted. The document frame is the host's; the test's shows the URL it got.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PdfPanel } from "./pdf-panel.js";
import { fakeFile, panelProps, pendingFile, type FakeFile } from "./testing.js";

vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { View } = await import("react-native");
  const { createElement } = await import("react");
  return {
    Loading: () => createElement(View, { testID: "loading" }),
    DocumentFrame: ({ url, testID }: { url: string; testID?: string }) =>
      createElement("div", { "data-testid": testID, "data-url": url }),
  };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

let container: HTMLElement;
let root: Root;

const settle = () => act(async () => void (await new Promise((done) => setTimeout(done, 0))));

async function mount(file: FakeFile): Promise<void> {
  await act(async () => root.render(<PdfPanel {...panelProps(file)} />));
  await settle();
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test("the file's local URL goes to the host's document frame", async () => {
  await mount(pendingFile("paper.pdf"));
  expect(container.querySelector('[data-testid="loading"]')).not.toBeNull();

  await mount(fakeFile("paper.pdf", "%PDF-1.7"));

  expect(container.querySelector('[data-testid="viewers-pdf"]')?.getAttribute("data-url")).toBe(
    "blob:%PDF-1.7",
  );
});

test("a file that cannot be read says why", async () => {
  await mount(fakeFile("paper.pdf", new Error("offline")));

  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "Unable to read the file: offline",
  );
});
